/**
 * Device encryption keys (E2E P0, protocol §2.4).
 *
 * Each browser device holds an X25519 *encryption* keypair, separate from its
 * Ed25519 device *signing* key. The external wallet (Klever Extension / K5)
 * authorizes the binding by signing a canonical claim, and the binding lets other
 * users wrap message keys to this device. `device_id` is the device signing key's
 * public key (the delegated ogd1… key).
 *
 * NOTE (P1 prerequisite): the enc private key is stored in IndexedDB (no OS keyring
 * on web). It is not yet used to decrypt anything (message encryption is P1). Before
 * P1, fold it into the wallet-encrypted key vault (P3, protocol §2.5).
 */
import {
  generateDeviceEncKeypair,
  encPublicKeyHex,
  buildDeviceEncBinding,
} from '@ogmara/sdk';
import { encVaultGet, encVaultStore, deviceVaultGetSigner } from './vault';
import { getSetting, setSetting } from './settings';
import { signMessage } from './klever';
import { getClient } from './api';

/** Load or create the device X25519 encryption keypair, persisting the secret. */
async function getOrCreateEncKeypair(): Promise<{ privateKey: Uint8Array; publicKeyHex: string }> {
  const existing = await encVaultGet();
  if (existing) {
    return { privateKey: existing, publicKeyHex: encPublicKeyHex(existing) };
  }
  const kp = generateDeviceEncKeypair();
  await encVaultStore(kp.privateKey);
  return kp;
}

/**
 * Ensure this device's encryption key is bound to the wallet on the node.
 * Idempotent: skips when already published for this (wallet, enc_pub). Best-effort —
 * a failure (offline, wallet rejected, PoW) leaves the marker unset so the next
 * connect retries.
 */
export async function ensureDeviceEncBinding(walletAddress: string): Promise<void> {
  if (!walletAddress) return;
  const deviceSigner = deviceVaultGetSigner();
  if (!deviceSigner) return; // device_id comes from the device signing key

  const kp = await getOrCreateEncKeypair();
  const marker = `${walletAddress}:${kp.publicKeyHex}`;
  if (getSetting('encKeyBound') === marker) return;

  const envelope = await buildDeviceEncBinding({
    walletAddress,
    encPubHex: kp.publicKeyHex,
    deviceIdHex: deviceSigner.publicKeyHex,
    // External wallet signMessage (Extension hex / K5 base64-of-hex); the SDK
    // normalizes the return internally.
    walletSign: (claim) => signMessage(claim),
  });
  await getClient().publishEncKeyEnvelope(walletAddress, envelope);
  setSetting('encKeyBound', marker);
}
