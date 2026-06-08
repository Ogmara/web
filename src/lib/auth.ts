/**
 * Auth state — reactive Solid.js signals for wallet authentication.
 *
 * Module-level signals (idiomatic Solid.js) — every component that needs
 * auth state imports directly from this module.
 */

import { createSignal } from 'solid-js';
import type { WalletSigner } from '@ogmara/sdk';
import { buildDeviceClaim, normalizeWalletSig, randomNonceHex } from '@ogmara/sdk';
import {
  vaultInit,
  vaultStore,
  vaultGenerate,
  vaultWipe,
  vaultGetSigner,
  vaultGetAddress,
  deviceVaultInit,
  deviceVaultGenerate,
  deviceVaultGetSigner,
  deviceVaultAdoptFromMainIfEmpty,
} from './vault';
import { getClient } from './api';
import { getSetting, setSetting } from './settings';
import { signMessage } from './klever';
import { setActiveSigner, getActiveSigner } from './signerRef';
import { ensureDeviceEncBinding } from './deviceEnc';

/** Attach a signer to the API client AND record it as the active L2 signer so
 *  non-auth modules (api/ws/boot) can read it without an import cycle. */
function attachSigner(s: WalletSigner): void {
  getClient().withSigner(s);
  setActiveSigner(s);
}

export type AuthStatus = 'none' | 'loading' | 'locked' | 'ready';
export type WalletSource = 'builtin' | 'klever-extension' | 'k5-delegation' | null;

const [authStatus, setAuthStatus] = createSignal<AuthStatus>('none');
const [walletAddress, setWalletAddress] = createSignal<string | null>(null);
const [walletSource, setWalletSource] = createSignal<WalletSource>(null);
const [isRegistered, setIsRegistered] = createSignal(false);
/** The L2 signing address (device key). Same as walletAddress for built-in wallets. */
const [l2Address, setL2Address] = createSignal<string | null>(null);
/** True if device registration on the L2 node failed (degraded to device-key identity). */
const [deviceMappingFailed, setDeviceMappingFailed] = createSignal(false);
/** Error message from the last failed device registration attempt. */
const [deviceMappingError, setDeviceMappingError] = createSignal<string | null>(null);

export { authStatus, walletAddress, walletSource, isRegistered, l2Address, deviceMappingFailed, deviceMappingError };

/** Get the current signer (from vault or external). */
export function getSigner(): WalletSigner | null {
  // The active signer is whatever the current connect/restore path attached —
  // a built-in wallet key, or the extension/K5 device key. Single source of
  // truth (set via attachSigner), so it's correct regardless of mode.
  return getActiveSigner();
}

/** Initialize auth on app startup. Loads vault, attaches signer to client. */
export async function initAuth(): Promise<void> {
  setAuthStatus('loading');
  try {
    const savedSource = getSetting('walletSource') as WalletSource;
    const savedAddress = getSetting('walletAddress');

    // Extension / K5: the L2 signer is the DEVICE key in its OWN vault slot.
    // Adopt a legacy device key from the shared KEY_PRIVATE slot if this user
    // predates the device slot (one-time, copy-only — the built-in wallet is
    // never touched), otherwise load the device slot directly.
    if (
      (savedSource === 'klever-extension' || savedSource === 'k5-delegation') &&
      savedAddress
    ) {
      const deviceSigner =
        (await deviceVaultAdoptFromMainIfEmpty()) ?? (await deviceVaultInit());
      if (deviceSigner) {
        deviceSigner.walletAddress = savedAddress;
        attachSigner(deviceSigner);
        const deviceAddr = deviceSigner.deviceAddress;
        setL2Address(deviceAddr);
        setWalletAddress(savedAddress);
        setWalletSource(savedSource);
        setAuthStatus('ready');
        // Re-register if the cache key was lost (e.g. localStorage cleared).
        ensureDeviceRegistered(deviceSigner, savedAddress, deviceAddr);
        checkRegistrationStatus();
        verifyDeviceMapping();
      } else {
        // No device key yet — reconnect the extension to mint one.
        setAuthStatus('none');
      }
      return;
    }

    // Built-in wallet (or unknown): the signer IS the wallet, from the main vault.
    const address = await vaultInit();
    if (address) {
      const signer = vaultGetSigner();
      if (signer) {
        attachSigner(signer);
        if (savedSource === 'builtin' && savedAddress) {
          setL2Address(address);
          setWalletAddress(address);
          setWalletSource('builtin');
          setAuthStatus('ready');
          checkRegistrationStatus();
        } else {
          // Vault has a key but no built-in source — orphaned; don't activate.
          setAuthStatus('none');
        }
        return;
      }
    }
    setAuthStatus('none');
  } catch {
    setAuthStatus('none');
  }
}

/** Connect with a hex-encoded private key (import). */
export async function connectWithKey(hexKey: string): Promise<string> {
  const address = await vaultStore(hexKey);
  const signer = vaultGetSigner()!;
  attachSigner(signer);
  setWalletAddress(address);
  setL2Address(address);
  setWalletSource('builtin');
  setSetting('walletSource', 'builtin');
  setSetting('walletAddress', address);
  setAuthStatus('ready');
  checkRegistrationStatus();
  return address;
}

/** Generate a new wallet and connect. */
export async function generateWallet(): Promise<string> {
  const address = await vaultGenerate();
  const signer = vaultGetSigner()!;
  attachSigner(signer);
  setWalletAddress(address);
  setL2Address(address);
  setWalletSource('builtin');
  setSetting('walletSource', 'builtin');
  setSetting('walletAddress', address);
  setAuthStatus('ready');
  checkRegistrationStatus();
  return address;
}

/**
 * Ensure the device key is registered on the L2 node.
 * Called on session restore — re-registers if the cache key is missing.
 *
 * IMPORTANT: device registration requires a fresh wallet signature from the
 * Klever Extension via `signMessage()`. On a cold page reload the extension
 * is not yet initialized (`Provider not init yet`) and `signMessage()` falls
 * back to the device key signing its own claim, which the L2 node correctly
 * rejects. To avoid the noisy 500/403 error on every reload, we skip the
 * call entirely when the extension isn't ready and just mark the mapping
 * as needing user attention. The user can fix it by clicking "Wallet
 * verbinden" again, which calls connectKleverExtension() with a hot
 * extension instance.
 */
async function ensureDeviceRegistered(
  signer: WalletSigner,
  walletAddr: string,
  deviceAddr: string,
): Promise<void> {
  const cacheKey = `${walletAddr}:${deviceAddr}`;
  const cached = getSetting('deviceRegistered');
  if (cached === cacheKey) return; // already registered

  // The Klever Extension injects window.klever / window.kleverWeb at page
  // load, but signMessage() throws "Provider not init yet" until the user
  // explicitly clicks "Wallet verbinden" and we call kleverWeb.initialize().
  // On a cold reload there's no way to get a real wallet signature without
  // that interaction, and the device-fallback path is correctly rejected by
  // the L2 node. So we just attempt the register and treat the specific
  // "Provider not init" failure as an expected skip — not an error. The
  // user re-triggers registration by clicking "Wallet verbinden" later.
  try {
    await registerDeviceOnNode(signer, walletAddr);
    setSetting('deviceRegistered', cacheKey);
    setDeviceMappingFailed(false);
    setDeviceMappingError(null);
  } catch (e: any) {
    // Do NOT raise the device-mapping banner here. This is a SPECULATIVE
    // re-registration on session restore; on a cold reload the Klever
    // Extension isn't initialized yet ("Provider not init"), so this call is
    // expected to be skipped — that's not a failure. And the node may already
    // know this device via delegation gossip from the node we first
    // registered on, so a missing local re-registration doesn't mean the
    // mapping is broken. `verifyDeviceMapping()` (called right after in
    // initAuth) is the SOLE authority: it asks the node whether the mapping
    // is actually live and shows the banner only if it genuinely isn't.
    const errMsg = e?.message || String(e);
    console.debug('[auth] speculative device re-registration skipped/failed (verifyDeviceMapping decides):', errMsg);
  }
}

/**
 * Connect via Klever Extension.
 *
 * The extension provides address + signing, but we also generate a
 * local device key for L2 operations (messages, reactions, etc.).
 * After connecting, registers the device key on the L2 node so that
 * all data produced by this device is indexed under the wallet address.
 */
export async function connectKleverExtension(extensionAddress: string): Promise<void> {
  // The extension provides the wallet; L2 ops are signed by a DEVICE key kept
  // in its OWN vault slot (separate from any built-in wallet in KEY_PRIVATE).
  // Load the existing device key or mint a fresh one. `signer`/`deviceAddress`
  // are `let` because the registration step may mint a fresh device key if the
  // current one is already bound to a different wallet (wallet switch / 409) —
  // and doing so NEVER touches the built-in wallet, so it's always safe.
  let signer = (await deviceVaultInit()) ?? (await deviceVaultGenerate());
  attachSigner(signer);

  // Device address uses ogd1... prefix (distinct from wallet's klv1...)
  let deviceAddress = signer.deviceAddress;

  // CRITICAL: set walletAddress on the signer BEFORE registerDeviceOnNode().
  //
  // The SDK's `signingAddress` getter returns `deviceAddress` (ogd1...) only
  // when `walletAddress` is set. Otherwise it returns `signer.address`, which
  // is the device key's own klv1-bech32 form — NOT the owning wallet's
  // address.
  //
  // If we leave walletAddress unset during register, the auth header sent on
  // the register call looks like:
  //   x-ogmara-address: klv1<device-self>       <- device's own klv1 form
  //
  // The l2-node register handler then fails its caller check at
  // routes.rs:2316:
  //   if auth_user.signing_address != device_address         // klv1<dev> != ogd1<dev>
  //     && auth_user.address != body.wallet_address          // klv1<dev> != klv1<wallet>
  //
  // both sides are true → 403 "caller must be the device or owning wallet".
  //
  // By setting walletAddress first, the auth header uses the ogd1 form, which
  // matches `device_address` derived from body.device_pubkey_hex, the
  // caller check passes, and registration proceeds.
  signer.walletAddress = extensionAddress;

  // Register device on L2 node (skip if already registered for this pair).
  const cached = getSetting('deviceRegistered');
  if (cached !== `${extensionAddress}:${deviceAddress}`) {
    // Device keys are EPHEMERAL and PER-WALLET. If this browser's existing
    // device key is already bound to a different wallet (i.e. you switched
    // wallets in the same browser), the node refuses to reassign it with a
    // 409 (cross-wallet hijack defense). The correct resolution is to mint a
    // FRESH device key for the new wallet and retry — NOT to steal the old
    // one (which would re-attribute the previous wallet's history). We retry
    // once after regenerating.
    let registered = false;
    for (let attempt = 0; attempt < 2 && !registered; attempt++) {
      try {
        await registerDeviceOnNode(signer, extensionAddress);
        registered = true;
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        const conflict =
          errMsg.includes('409') || errMsg.includes('already linked');
        if (conflict && attempt === 0) {
          // This device key is bound to a different wallet (you switched
          // wallets). Mint a FRESH device key in the device slot and retry.
          // This only writes KEY_DEVICE_PRIVATE — the built-in wallet
          // (KEY_PRIVATE) is never touched — so it is unconditionally safe.
          signer = await deviceVaultGenerate();
          attachSigner(signer);
          signer.walletAddress = extensionAddress;
          deviceAddress = signer.deviceAddress;
          continue;
        }
        // Genuine failure (or the retry also failed) — continue without the
        // mapping. The node falls back to using the device key as identity.
        console.warn('Device registration failed, continuing without mapping:', errMsg);
        setDeviceMappingFailed(true);
        setDeviceMappingError(errMsg);
      }
    }
    if (registered) {
      setSetting('deviceRegistered', `${extensionAddress}:${deviceAddress}`);
      setDeviceMappingFailed(false);
    }
  }

  // Extension address = on-chain identity, device key = L2 signing.
  setWalletAddress(extensionAddress);
  setL2Address(deviceAddress);
  setWalletSource('klever-extension');
  setSetting('walletSource', 'klever-extension');
  setSetting('walletAddress', extensionAddress);
  setAuthStatus('ready');
  checkRegistrationStatus();
  verifyDeviceMapping();

  // Publish this device's encryption-key binding (E2E P0, §2.4). Best-effort +
  // idempotent: the wallet signs the claim (Extension/K5); retries next connect.
  void ensureDeviceEncBinding(extensionAddress).catch((e) =>
    console.warn('[deviceEnc] binding failed:', e),
  );
}

/**
 * One-off repair for wallets affected by the l2-node v0.15.0 migration bug
 * (server's JSON vs MessagePack format mismatch corrupts pre-v0.15 device
 * entries in WALLET_DEVICES). Symptom: `POST /devices/register` returns
 * `500 internal error` because `list_devices` fails to deserialize the
 * corrupted entry.
 *
 * Workaround: call `DELETE /api/v1/devices/{legacyDeviceAddress}` with auth
 * headers signed by the Klever Extension (as the owning wallet). The
 * `revoke_device` storage handler uses raw get_cf/delete_cf operations with
 * no deserialization, so it can clean up corrupted entries. After that, a
 * fresh register call succeeds.
 *
 * Usage from DevTools console:
 *   await window.__ogmaraRepair('ogd1vdmr0qmq...p7l0tu')
 *
 * Requires the Klever Extension to be connected to the owning wallet.
 */
async function repairLegacyDevice(legacyDeviceAddress: string): Promise<void> {
  // The current walletAddress signal holds the owning klv1 wallet.
  const wallet = walletAddress();
  if (!wallet) {
    throw new Error('No wallet connected. Connect Klever Extension first, then run repair.');
  }
  if (!legacyDeviceAddress.startsWith('ogd1')) {
    throw new Error(`Expected an ogd1... device address, got "${legacyDeviceAddress}"`);
  }

  const timestamp = Date.now();
  const path = `/api/v1/devices/${legacyDeviceAddress}`;

  // Use same-origin so the Vite dev proxy (or the real node in prod) forwards
  // transparently.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Host-bound auth (audit 2026-06-07): bind the signature to the node's
  // {network, node_id} + a fresh single-use nonce. Fetch the binding from
  // /health (same node we're about to call).
  const healthResp = await fetch(`${origin}/api/v1/health`);
  if (!healthResp.ok) throw new Error(`health fetch failed: ${healthResp.status}`);
  const health = await healthResp.json() as { node_id?: string; network?: string };
  if (!health.node_id || !health.network) {
    throw new Error('node /health did not return node_id/network — node too old for host-bound auth');
  }
  const nonce = randomNonceHex();
  const authString =
    `ogmara-auth:${health.network}:${health.node_id}:${nonce}:${timestamp}:DELETE:${path}`;

  // Ask the Klever Extension to sign the auth string AS THE WALLET.
  // This uses the user's klv1... wallet key (not the local device key),
  // which is the only identity that can authorize revoking a device it owns.
  // Normalize across wallet encodings (Extension returns hex, K5 returns
  // base64-of-hex) → 64 raw signature bytes, then base64 for the auth header.
  const sigBytes = normalizeWalletSig(await signMessage(authString));
  const sigB64 = btoa(String.fromCharCode(...sigBytes));

  const url = `${origin}${path}`;

  console.info(`[repair] DELETE ${path} — wallet: ${wallet}, legacy device: ${legacyDeviceAddress}`);
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'x-ogmara-auth': sigB64,
      'x-ogmara-address': wallet, // sign as the wallet, not the device
      'x-ogmara-timestamp': String(timestamp),
      'x-ogmara-nonce': nonce,
    },
  });

  const respText = await resp.text().catch(() => '');
  if (!resp.ok) {
    throw new Error(`Repair failed: ${resp.status} ${resp.statusText}: ${respText.slice(0, 200)}`);
  }
  console.info(`[repair] ✓ Server accepted revoke: ${respText}`);

  // Clear the cached registration flag so the next connect re-registers.
  setSetting('deviceRegistered', '');
  console.info('[repair] Cleared deviceRegistered cache. Disconnect + reconnect to re-register.');
}

// Expose the repair helper on window in dev mode only (DevTools console).
// Remove once the l2-node v0.15.0 migration is fully resolved.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__ogmaraRepair = repairLegacyDevice;
}

/**
 * Register a device key on the L2 node under a wallet address.
 *
 * 1. Builds the claim string: "ogmara-device-claim:{pubkey}:{wallet}:{ts}"
 * 2. Klever Extension signs it (Klever message format)
 * 3. Submits to the node via POST /api/v1/devices/register
 */
async function registerDeviceOnNode(
  signer: WalletSigner,
  walletAddress: string,
): Promise<void> {
  const { claimString, timestamp } = buildDeviceClaim(
    signer.publicKeyHex,
    walletAddress,
  );

  // Try wallet signature first (desktop Klever Extension), then device-signed fallback
  let sigHex: string | null = null;
  let sigSource: 'klever-extension' | 'device-fallback' = 'device-fallback';
  try {
    const result = await signMessage(claimString);
    // Normalize across wallet encodings (Extension hex / K5 base64-of-hex) → hex.
    sigHex = Array.from(normalizeWalletSig(result), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    sigSource = 'klever-extension';
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    // "Provider not init yet" = Klever Extension installed but not yet
    // initialize()-d (e.g. cold page reload, no user interaction). Bail out
    // instead of submitting a device-signed claim that the L2 node rejects.
    if (errMsg.includes('Provider not init') || errMsg.includes('not available')) {
      throw new Error('Provider not init yet');
    }
    console.warn('[register] signMessage failed, will use device fallback:', errMsg);
  }

  if (!sigHex) {
    // Device signs the claim itself (K5 mobile browser fallback)
    const sigBytes = await signer.signKleverMessage(new TextEncoder().encode(claimString));
    sigHex = Array.from(sigBytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  console.info(
    `[register] POST /devices/register — sig source: ${sigSource}, ` +
    `wallet: ${walletAddress.slice(0, 12)}…${walletAddress.slice(-6)}, ` +
    `device pubkey: ${signer.publicKeyHex.slice(0, 12)}…, ` +
    `auth header address: ${signer.walletAddress ? signer.deviceAddress : signer.address}`,
  );

  // Submit to the L2 node
  await getClient().registerDevice(sigHex, walletAddress, timestamp);
}

/** Disconnect wallet and wipe vault. */
export async function disconnectWallet(): Promise<void> {
  const source = walletSource();
  if (source === 'klever-extension' || source === 'k5-delegation') {
    // Keep the device key — only clear the extension/delegation association
    // so the same L2 identity is reused on reconnect
  } else {
    // Built-in wallet: wipe everything
    await vaultWipe();
  }
  setSetting('walletSource', '');
  setSetting('walletAddress', '');
  setSetting('deviceRegistered', '');
  // Clear the enc-key binding marker so reconnect re-publishes (idempotent). The
  // enc key itself follows the device key: kept for extension/K5, dropped by the
  // built-in vaultWipe above.
  setSetting('encKeyBound', '');
  setActiveSigner(null);
  setWalletAddress(null);
  setL2Address(null);
  setWalletSource(null);
  setAuthStatus('none');
  setIsRegistered(false);
  // Drop the cached own avatar so a different account doesn't inherit it.
  import('./ownAvatar').then(({ clearOwnAvatar }) => clearOwnAvatar()).catch(() => {});
}

/** Update on-chain registration status. */
export function setRegistrationStatus(registered: boolean): void {
  setIsRegistered(registered);
}

/**
 * Check on-chain registration status by querying the L2 node's user profile.
 * A user is "verified" when `registered_at > 0` (set by the chain scanner
 * from a SC UserRegistered event, not from a ProfileUpdate).
 */
export async function checkRegistrationStatus(): Promise<void> {
  const addr = walletAddress();
  if (!addr) return;
  try {
    const resp = await getClient().getUserProfile(addr);
    setIsRegistered(resp.user.registered_at > 0);
    // Cache the user's OWN avatar image locally while we're (presumably) on a
    // node that has it, so it keeps rendering after switching to a node
    // without IPFS / without this user's media. Best-effort, fire-and-forget.
    import('./ownAvatar').then(({ ensureOwnAvatarCached }) =>
      ensureOwnAvatarCached(resp.user.avatar_cid),
    ).catch(() => { /* non-critical */ });
  } catch {
    // User not found on node or network error — assume unverified
    setIsRegistered(false);
  }
}

/**
 * Re-attempt device → wallet registration on the L2 node.
 *
 * Used by the device-mapping banner: clears the deviceRegistered cache,
 * re-runs `registerDeviceOnNode` with the current extension session, then
 * re-verifies. The user must have an active Klever Extension popup
 * available (we'll prompt for a signature). Returns true on success.
 */
export async function relinkDevice(): Promise<boolean> {
  const source = walletSource();
  const wallet = walletAddress();
  if (source !== 'klever-extension' || !wallet) return false;
  // The L2 signer is the device key (its own slot); load or mint one.
  let signer = deviceVaultGetSigner() ?? (await deviceVaultInit());
  if (!signer) signer = await deviceVaultGenerate();
  // Bust the cache so registerDeviceOnNode actually runs
  setSetting('deviceRegistered', '');
  for (let attempt = 0; attempt < 2; attempt++) {
    signer.walletAddress = wallet;
    attachSigner(signer);
    try {
      await registerDeviceOnNode(signer, wallet);
      setSetting('deviceRegistered', `${wallet}:${signer.deviceAddress}`);
      setL2Address(signer.deviceAddress);
      setDeviceMappingFailed(false);
      setDeviceMappingError(null);
      await verifyDeviceMapping();
      return !deviceMappingFailed();
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      const conflict =
        errMsg.includes('409') || errMsg.includes('already linked');
      if (conflict && attempt === 0) {
        // Device key bound to another wallet — mint a fresh one (device slot
        // only; never touches the built-in wallet) and retry.
        signer = await deviceVaultGenerate();
        continue;
      }
      setDeviceMappingFailed(true);
      setDeviceMappingError(errMsg);
      return false;
    }
  }
  return false;
}

/**
 * Verify that the L2 node has the current device → wallet mapping live.
 *
 * Authenticates as the device key and calls `GET /api/v1/devices`. The node's
 * auth middleware resolves the signing device address through DEVICES CF and
 * returns the resolved wallet plus the device list. If the resolution returns
 * our connected wallet AND our device is in the list, the mapping is live.
 *
 * If not (registration call silently failed, node lost the mapping, cache
 * lied) we mark `deviceMappingFailed` so the UI can surface a banner. Without
 * this check, the user appears authenticated but every read/write is keyed to
 * the orphan device address — invisible private channels, missing DMs, every
 * advanced action rejected with "on-chain registration required".
 *
 * Only meaningful for `klever-extension` and `k5-delegation` modes; built-in
 * wallets sign as themselves and never need a mapping.
 */
export async function verifyDeviceMapping(): Promise<void> {
  const source = walletSource();
  if (source !== 'klever-extension' && source !== 'k5-delegation') {
    setDeviceMappingFailed(false);
    setDeviceMappingError(null);
    return;
  }
  const expectedWallet = walletAddress();
  const expectedDevice = l2Address();
  if (!expectedWallet || !expectedDevice) return;
  try {
    const resp = await getClient().listDevices();
    const walletMatches = resp.wallet_address === expectedWallet;
    const deviceListed = resp.devices.some((d) => d.device_address === expectedDevice);
    if (walletMatches && deviceListed) {
      setDeviceMappingFailed(false);
      setDeviceMappingError(null);
    } else {
      setDeviceMappingFailed(true);
      setDeviceMappingError(
        walletMatches
          ? 'Device key not in wallet device list'
          : 'Node resolved a different wallet for this device key',
      );
    }
  } catch (e: any) {
    // Network errors don't necessarily mean broken mapping — only flip the
    // flag for a clear "unauthorized" signal. Other errors leave existing
    // state untouched.
    const msg = e?.message || String(e);
    if (msg.includes('401') || msg.includes('403')) {
      setDeviceMappingFailed(true);
      setDeviceMappingError(msg);
    }
  }
}
