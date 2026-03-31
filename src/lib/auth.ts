/**
 * Auth state — reactive Solid.js signals for wallet authentication.
 *
 * Module-level signals (idiomatic Solid.js) — every component that needs
 * auth state imports directly from this module.
 */

import { createSignal } from 'solid-js';
import type { WalletSigner } from '@ogmara/sdk';
import {
  vaultInit,
  vaultStore,
  vaultGenerate,
  vaultWipe,
  vaultGetSigner,
  vaultGetAddress,
} from './vault';
import { getClient } from './api';

export type AuthStatus = 'none' | 'loading' | 'locked' | 'ready';
export type WalletSource = 'builtin' | 'klever-extension' | 'k5-delegation' | null;

const [authStatus, setAuthStatus] = createSignal<AuthStatus>('none');
const [walletAddress, setWalletAddress] = createSignal<string | null>(null);
const [walletSource, setWalletSource] = createSignal<WalletSource>(null);
const [isRegistered, setIsRegistered] = createSignal(false);

export { authStatus, walletAddress, walletSource, isRegistered };

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
        setWalletAddress(address);
        setWalletSource('builtin');
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
  setWalletSource('builtin');
  setAuthStatus('ready');
  return address;
}

/** Generate a new wallet and connect. */
export async function generateWallet(): Promise<string> {
  const address = await vaultGenerate();
  const signer = vaultGetSigner()!;
  getClient().withSigner(signer);
  setWalletAddress(address);
  setWalletSource('builtin');
  setAuthStatus('ready');
  return address;
}

/**
 * Connect via Klever Extension.
 * The extension provides address + signing, but we also generate a
 * local device key for L2 operations (messages, reactions, etc.).
 */
export async function connectKleverExtension(extensionAddress: string): Promise<void> {
  // Generate a local device key for L2 signing
  const address = await vaultGenerate();
  const signer = vaultGetSigner()!;
  getClient().withSigner(signer);
  // The extension address is the on-chain identity
  // The local key is used for L2 operations (until device delegation is set up)
  setWalletAddress(extensionAddress);
  setWalletSource('klever-extension');
  setAuthStatus('ready');
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
    setAuthStatus('ready');
  }
}

/** Disconnect wallet and wipe vault. */
export async function disconnectWallet(): Promise<void> {
  await vaultWipe();
  setWalletAddress(null);
  setWalletSource(null);
  setAuthStatus('none');
  setIsRegistered(false);
}

/** Update on-chain registration status. */
export function setRegistrationStatus(registered: boolean): void {
  setIsRegistered(registered);
}
