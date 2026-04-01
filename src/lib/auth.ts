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

export { authStatus, walletAddress, walletSource, isRegistered, l2Address, deviceMappingFailed };

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

        // L2 address is always the device key (signer) address
        setL2Address(address);

        if (savedSource === 'klever-extension' && savedAddress) {
          setWalletAddress(savedAddress);
          setWalletSource('klever-extension');
          // Restore wallet address on the signer for identity resolution
          signer.walletAddress = savedAddress;
        } else if (savedSource === 'k5-delegation' && savedAddress) {
          setWalletAddress(savedAddress);
          setWalletSource('k5-delegation');
          signer.walletAddress = savedAddress;
        } else {
          setWalletAddress(address);
          setWalletSource('builtin');
        }
        setAuthStatus('ready');
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
  return address;
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
  let deviceAddress = await vaultInit();
  if (!deviceAddress) {
    deviceAddress = await vaultGenerate();
  }
  const signer = vaultGetSigner()!;
  getClient().withSigner(signer);

  // Register device on L2 node (skip if already registered for this pair)
  const cacheKey = `${extensionAddress}:${deviceAddress}`;
  const cached = getSetting('deviceRegistered');
  if (cached !== cacheKey) {
    try {
      await registerDeviceOnNode(signer, extensionAddress);
      setSetting('deviceRegistered', cacheKey);
      setDeviceMappingFailed(false);
    } catch (e) {
      // Registration failed — continue without it. The node falls back to
      // using the device key as identity (built-in wallet mode).
      console.warn('Device registration failed, continuing without mapping:', e);
      setDeviceMappingFailed(true);
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

  // Extension signs the claim using Klever message signing format
  const walletSigHex = await signMessage(claimString);

  // Submit to the L2 node
  await getClient().registerDevice(walletSigHex, walletAddress, timestamp);
}

/**
 * Connect via K5 wallet delegation.
 * The device key was pre-generated; K5 signed the delegation on-chain.
 */
export function connectK5Delegation(deviceAddress: string): void {
  const signer = vaultGetSigner();
  if (signer) {
    getClient().withSigner(signer);
    setWalletAddress(deviceAddress);
    setWalletSource('k5-delegation');
    setSetting('walletSource', 'k5-delegation');
    setSetting('walletAddress', deviceAddress);
    setAuthStatus('ready');
  }
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
