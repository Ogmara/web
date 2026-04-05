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
 */
async function ensureDeviceRegistered(
  signer: WalletSigner,
  walletAddr: string,
  deviceAddr: string,
): Promise<void> {
  const cacheKey = `${walletAddr}:${deviceAddr}`;
  const cached = getSetting('deviceRegistered');
  if (cached === cacheKey) return; // already registered

  try {
    await registerDeviceOnNode(signer, walletAddr);
    setSetting('deviceRegistered', cacheKey);
    setDeviceMappingFailed(false);
    setDeviceMappingError(null);
  } catch (e: any) {
    const errMsg = e?.message || String(e);
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

  // Extension address = on-chain identity, device key = L2 signing
  signer.walletAddress = extensionAddress;
  setWalletAddress(extensionAddress);
  setL2Address(deviceAddress);
  setWalletSource('klever-extension');
  setSetting('walletSource', 'klever-extension');
  setSetting('walletAddress', extensionAddress);
  setAuthStatus('ready');
  checkRegistrationStatus();
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
  try {
    const result = await signMessage(claimString);
    if (typeof result === 'string' && /^[0-9a-fA-F]{128}$/.test(result)) {
      sigHex = result;
    }
  } catch {
    // signMessage not available or failed — will use device fallback below
  }

  if (!sigHex) {
    // Device signs the claim itself (K5 mobile browser fallback)
    const sigBytes = await signer.signKleverMessage(new TextEncoder().encode(claimString));
    sigHex = Array.from(sigBytes, b => b.toString(16).padStart(2, '0')).join('');
  }

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
