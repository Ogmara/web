/**
 * Device encryption keys (E2E P0, protocol §2.4).
 *
 * Each browser device holds an X25519 *encryption* keypair, separate from the
 * wallet/device signing key. The wallet authorizes the binding by signing a
 * canonical claim, and the binding lets other users wrap message keys to this
 * device.
 *
 * `device_id` depends on the wallet source:
 *   - Klever Extension / K5: the delegated device signing key's public key
 *     (`ogd1…` key) — there IS a separate L2 device signer.
 *   - Built-in wallet: there is NO separate device signing key (L2 ops are
 *     signed with the wallet key directly), so we mint a stable random
 *     per-install `device_id` — same model desktop uses. (Accepted spec
 *     deviation, see `getOrCreateDeviceId`.)
 *
 * NOTE (P1 prerequisite): the enc private key is stored in IndexedDB (no OS keyring
 * on web). Before P3 ships, fold it into the wallet-encrypted key vault (§2.5).
 */
import {
  generateDeviceEncKeypair,
  encPublicKeyHex,
  buildDeviceEncBinding,
  buildDeviceEncRevoke,
  type WalletSignFn,
} from '@ogmara/sdk';
import { encVaultGet, encVaultStore, deviceVaultGetSigner } from './vault';
import { getSetting, setSetting } from './settings';
import { signMessage } from './klever';
import { getActiveSigner } from './signerRef';
import { getClient } from './api';
import { e2elog, withRetry } from './e2eDebug';

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Stable per-install device identifier (32-byte hex) for the BUILT-IN wallet
 * model. Public, persisted once.
 *
 * ACCEPTED SPEC DEVIATION (protocol §2.4): §2.4 defines `device_id` as the
 * device's Ed25519 *signing* key. A built-in wallet has no separate device
 * signing key (it signs with the wallet key directly), so we mint a random
 * stable per-install `device_id` instead. The node accepts this (router
 * validation only checks the value is 32-byte hex). Mirrors desktop. Behavior
 * is intentional — do not "fix" by deriving it from a key.
 */
export function getOrCreateDeviceId(): string {
  let id = getSetting('deviceId');
  if (!id) {
    id = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    setSetting('deviceId', id);
  }
  return id;
}

/** True when the connected wallet is an external Klever Extension / K5 wallet. */
function isExternalWallet(): boolean {
  const src = getSetting('walletSource');
  return src === 'klever-extension' || src === 'k5-delegation';
}

/**
 * The device id for the *current* wallet source. For external wallets it is the
 * delegated device signing key (`ogd1…`); for built-in wallets it is the stable
 * random per-install id. Returns null only if an external wallet has no device
 * signer yet (caller should skip).
 */
function currentDeviceId(): string | null {
  if (isExternalWallet()) {
    return deviceVaultGetSigner()?.publicKeyHex ?? null;
  }
  return getOrCreateDeviceId();
}

/**
 * A wallet-sign function over the canonical claim. The claim must be signed by
 * the WALLET key (the binding authority):
 *   - external wallet → `signMessage` (Extension/K5 signs as the wallet);
 *   - built-in wallet → the active signer IS the wallet key, sign directly.
 */
function walletSignFn(): WalletSignFn {
  if (isExternalWallet()) {
    return (claim) => signMessage(claim);
  }
  return async (claim) => {
    const signer = getActiveSigner();
    if (!signer) throw new Error('no active signer for enc-key binding');
    return signer.signKleverMessage(new TextEncoder().encode(claim));
  };
}

export { currentDeviceId };

/** Load or create the device X25519 encryption keypair, persisting the secret. */
export async function getOrCreateEncKeypair(): Promise<{ privateKey: Uint8Array; publicKeyHex: string }> {
  const existing = await encVaultGet();
  if (existing) {
    return { privateKey: existing, publicKeyHex: encPublicKeyHex(existing) };
  }
  const kp = generateDeviceEncKeypair();
  await encVaultStore(kp.privateKey);
  return kp;
}

/**
 * Revoke any of MY OWN previously-published enc keys for `deviceId` whose
 * `enc_pub` differs from my current one. The node keys `device_enc_keys` by
 * `enc_pub` (not device_id), so a regenerated enc key would otherwise leave the
 * stale enc_pub *active* — and since `channel_keys` envelopes are keyed by
 * `device_id` (first-write-wins), a sender wrapping to BOTH enc_pubs of one
 * device can have the stale wrapping win, making messages undecryptable.
 * Revoking the stale enc_pub guarantees exactly one active enc_pub per device.
 * Best-effort: a failure just leaves the duplicate (defended in `establishMyKey`
 * by the newest-per-device dedup).
 */
async function revokeStaleEncKeys(
  wallet: string,
  deviceId: string,
  currentEncPub: string,
  sign: WalletSignFn,
): Promise<void> {
  try {
    const { keys } = await getClient().getEncKeys(wallet);
    const did = deviceId.toLowerCase();
    const cur = currentEncPub.toLowerCase();
    const stale = keys.filter(
      (k) => (k.device_id ?? '').toLowerCase() === did && (k.enc_pub ?? '').toLowerCase() !== cur,
    );
    for (const k of stale) {
      const revoke = await buildDeviceEncRevoke({
        walletAddress: wallet,
        encPubHex: k.enc_pub,
        walletSign: sign,
      });
      await withRetry(() => getClient().publishEncKeyEnvelope(wallet, revoke), 'revoke stale enc-key');
      e2elog('revoked stale enc_pub', { deviceId, staleEncPub: k.enc_pub });
    }
  } catch (e) {
    console.warn('[deviceEnc] stale enc-key revoke skipped:', e);
  }
}

/**
 * Ensure this device's encryption key is bound to the wallet on the node.
 * Idempotent: skips when already published for this (wallet, enc_pub). Best-effort —
 * a failure (offline, wallet rejected, PoW) leaves the marker unset so the next
 * connect retries. On a key change, supersedes the old enc_pub (revoke) so the
 * directory holds exactly one active enc_pub per device.
 */
export async function ensureDeviceEncBinding(walletAddress: string): Promise<void> {
  if (!walletAddress) return;
  const deviceId = currentDeviceId();
  if (!deviceId) return; // external wallet without a device signer yet — retry later

  const kp = await getOrCreateEncKeypair();
  const marker = `v2:${walletAddress}:${kp.publicKeyHex}`;

  // Registry-verified (not just the local marker): the marker only records what
  // WE last published — it can't see that the node's enc_pub for our device_id
  // diverged from our current local enc_pub (the "can't decrypt" cause). Confirm
  // the node actually has THIS device_id bound to our CURRENT enc_pub; only skip
  // when the registry agrees AND the marker is set.
  let registryOk = false;
  try {
    const { keys } = await getClient().getEncKeys(walletAddress);
    const mine = keys.find((k) => (k.device_id ?? '').toLowerCase() === deviceId.toLowerCase());
    registryOk = !!mine && (mine.enc_pub ?? '').toLowerCase() === kp.publicKeyHex.toLowerCase();
    e2elog('binding check', {
      wallet: walletAddress, deviceId, localEncPub: kp.publicKeyHex,
      registryEncPub: mine?.enc_pub ?? null, registryOk, markerSet: getSetting('encKeyBound') === marker,
    });
  } catch {
    // Registry unreachable (429/offline): fall back to the local marker so we
    // don't hammer the node; retry on the next login.
    if (getSetting('encKeyBound') === marker) return;
  }
  if (registryOk && getSetting('encKeyBound') === marker) return;

  const sign = walletSignFn();
  const envelope = await buildDeviceEncBinding({
    walletAddress,
    encPubHex: kp.publicKeyHex,
    deviceIdHex: deviceId,
    walletSign: sign,
  });
  await withRetry(() => getClient().publishEncKeyEnvelope(walletAddress, envelope), 'publish binding');
  e2elog('published binding', { deviceId, encPub: kp.publicKeyHex });
  // Retire any stale enc_pub for this device AFTER the new key is registered, so
  // there is never a window with zero active keys for the device.
  await revokeStaleEncKeys(walletAddress, deviceId, kp.publicKeyHex, sign);
  setSetting('encKeyBound', marker);
}
