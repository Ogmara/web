/**
 * Auth state — reactive Solid.js signals for wallet authentication.
 *
 * Module-level signals (idiomatic Solid.js) — every component that needs
 * auth state imports directly from this module.
 */

import { createSignal } from 'solid-js';
import type { WalletSigner } from '@ogmara/sdk';
import { buildDeviceClaim } from '@ogmara/sdk';
import {
  vaultInit,
  vaultStore,
  vaultGenerate,
  vaultWipe,
  vaultGetSigner,
  vaultGetAddress,
} from './vault';
import { getClient } from './api';
import { getSetting, setSetting } from './settings';
import { signMessage } from './klever';

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
  return vaultGetSigner();
}

/** Guard: throws if no signer is available. Use in action handlers. */
export function requireAuth(): WalletSigner {
  const signer = vaultGetSigner();
  if (!signer) throw new Error('Wallet not connected');
  return signer;
}

/** Initialize auth on app startup. Loads vault, attaches signer to client. */
export async function initAuth(): Promise<void> {
  setAuthStatus('loading');
  try {
    const address = await vaultInit();
    if (address) {
      const signer = vaultGetSigner();
      if (signer) {
        getClient().withSigner(signer);

        // Restore wallet source and address from persisted settings
        const savedSource = getSetting('walletSource') as WalletSource;
        const savedAddress = getSetting('walletAddress');

        if (savedSource === 'klever-extension' && savedAddress) {
          // Device address uses ogd1... prefix for delegated keys
          const deviceAddr = signer.deviceAddress;
          setL2Address(deviceAddr);
          setWalletAddress(savedAddress);
          setWalletSource('klever-extension');
          signer.walletAddress = savedAddress;
          setAuthStatus('ready');
          // Re-register device if cache key was lost (e.g. localStorage cleared)
          ensureDeviceRegistered(signer, savedAddress, deviceAddr);
          checkRegistrationStatus();
        } else if (savedSource === 'k5-delegation' && savedAddress) {
          const deviceAddr = signer.deviceAddress;
          setL2Address(deviceAddr);
          setWalletAddress(savedAddress);
          setWalletSource('k5-delegation');
          signer.walletAddress = savedAddress;
          setAuthStatus('ready');
          ensureDeviceRegistered(signer, savedAddress, deviceAddr);
          checkRegistrationStatus();
        } else if (savedSource === 'builtin' && savedAddress) {
          // Built-in wallet mode: signer IS the wallet, uses klv1...
          setL2Address(address);
          setWalletAddress(address);
          setWalletSource('builtin');
          setAuthStatus('ready');
          checkRegistrationStatus();
        } else {
          // Vault has a key but no wallet source saved (e.g. localStorage cleared).
          // This is an orphaned device key — don't activate as a wallet.
          // Keep the signer attached for when the user reconnects their wallet,
          // but don't set auth to 'ready'.
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
  getClient().withSigner(signer);
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
  getClient().withSigner(signer);
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
    const errMsg = e?.message || String(e);
    if (errMsg.includes('Provider not init') || errMsg.includes('not available')) {
      console.debug('[auth] Skipping device re-registration: Klever Extension not initialized');
      setDeviceMappingFailed(true);
      setDeviceMappingError('Klever Extension not initialized');
      return;
    }
    console.warn('Device re-registration failed:', errMsg);
    setDeviceMappingFailed(true);
    setDeviceMappingError(errMsg);
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
  // Reuse existing device key if available, otherwise generate a new one
  const vaultAddr = await vaultInit() ?? await vaultGenerate();
  const signer = vaultGetSigner()!;
  getClient().withSigner(signer);

  // Device address uses ogd1... prefix (distinct from wallet's klv1...)
  const deviceAddress = signer.deviceAddress;
  void vaultAddr; // vault returns klv1; we use ogd1 for device identity

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

  // Register device on L2 node (skip if already registered for this pair)
  const cacheKey = `${extensionAddress}:${deviceAddress}`;
  const cached = getSetting('deviceRegistered');
  if (cached !== cacheKey) {
    try {
      await registerDeviceOnNode(signer, extensionAddress);
      setSetting('deviceRegistered', cacheKey);
      setDeviceMappingFailed(false);
    } catch (e: any) {
      // Registration failed — continue without it. The node falls back to
      // using the device key as identity (built-in wallet mode).
      const errMsg = e?.message || String(e);
      console.warn('Device registration failed, continuing without mapping:', errMsg);
      setDeviceMappingFailed(true);
      setDeviceMappingError(errMsg);
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
  const authString = `ogmara-auth:${timestamp}:DELETE:${path}`;

  // Ask the Klever Extension to sign the auth string AS THE WALLET.
  // This uses the user's klv1... wallet key (not the local device key),
  // which is the only identity that can authorize revoking a device it owns.
  const hexSig = await signMessage(authString);
  if (!/^[0-9a-fA-F]{128}$/.test(hexSig)) {
    throw new Error(`Klever Extension returned non-hex signature: ${hexSig}`);
  }

  // Convert 64-byte hex signature to base64 for the X-Ogmara-Auth header.
  const sigBytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sigBytes[i] = parseInt(hexSig.substring(i * 2, i * 2 + 2), 16);
  const sigB64 = btoa(String.fromCharCode(...sigBytes));

  // Use same-origin path so the Vite dev proxy (or the real node in prod)
  // forwards transparently.
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  console.info(`[repair] DELETE ${path} — wallet: ${wallet}, legacy device: ${legacyDeviceAddress}`);
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'x-ogmara-auth': sigB64,
      'x-ogmara-address': wallet, // sign as the wallet, not the device
      'x-ogmara-timestamp': String(timestamp),
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

// Expose the repair helper on window so the user can call it from DevTools.
if (typeof window !== 'undefined') {
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
    if (typeof result === 'string' && /^[0-9a-fA-F]{128}$/.test(result)) {
      sigHex = result;
      sigSource = 'klever-extension';
    } else {
      console.warn('[register] signMessage returned non-hex result:', typeof result, result);
    }
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

/**
 * Connect via K5 wallet delegation.
 * The device key was pre-generated; K5 signed the delegation on-chain.
 *
 * @param k5WalletAddress - The K5 wallet address that delegated (from callback or on-chain event)
 */
export async function connectK5Delegation(k5WalletAddress: string): Promise<void> {
  const signer = vaultGetSigner();
  if (!signer) return;

  getClient().withSigner(signer);
  const deviceAddress = signer.deviceAddress;

  // Register the device on the L2 node under the K5 wallet address.
  // The on-chain delegation proves ownership; now the L2 node needs to know too.
  const cacheKey = `${k5WalletAddress}:${deviceAddress}`;
  const cached = getSetting('deviceRegistered');
  if (cached !== cacheKey) {
    try {
      // K5 signed the delegation on-chain, but we also need a Klever-message
      // signature for L2 node registration. Since we can't call K5 again for
      // a message signature, we rely on the on-chain delegation being sufficient.
      // The L2 node's chain scanner will pick up the deviceDelegated event and
      // create the mapping automatically.
      // For now, just mark as pending — the chain scanner will resolve it.
      console.info('K5 delegation: waiting for chain scanner to pick up device mapping');
    } catch {
      // Non-critical
    }
  }

  // Set the wallet address to the K5 wallet (NOT the device address)
  signer.walletAddress = k5WalletAddress;
  setWalletAddress(k5WalletAddress);
  setL2Address(deviceAddress);
  setWalletSource('k5-delegation');
  setSetting('walletSource', 'k5-delegation');
  setSetting('walletAddress', k5WalletAddress);
  setAuthStatus('ready');
  checkRegistrationStatus();
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
  setWalletAddress(null);
  setL2Address(null);
  setWalletSource(null);
  setAuthStatus('none');
  setIsRegistered(false);
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
  } catch {
    // User not found on node or network error — assume unverified
    setIsRegistered(false);
  }
}
