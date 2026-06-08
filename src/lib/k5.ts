/**
 * K5 Mobile Wallet integration — deep link flow for device delegation.
 *
 * K5 is Klever's mobile wallet app. On mobile browsers, we can't use the
 * browser extension, so we use deep links to delegate signing authority
 * from the K5 wallet to a device key generated in the browser.
 *
 * Flow:
 * 1. Web app generates a device keypair in vault
 * 2. Deep link to K5: klever://delegate?...
 * 3. K5 signs a delegateDevice TX on-chain
 * 4. User returns to web app via callback URL
 * 5. Web app uses the device key for L2 operations
 */

import { createSignal } from 'solid-js';
import { deviceVaultGenerate } from './vault';

const [k5Available, setK5Available] = createSignal(false);
const [k5Connecting, setK5Connecting] = createSignal(false);
const [k5DelegationPending, setK5DelegationPending] = createSignal(false);

export { k5Available, k5Connecting, k5DelegationPending };

/**
 * Detect if we're on a mobile browser where K5 deep links are available.
 * K5 deep links work on iOS and Android mobile browsers.
 */
export function detectK5(): void {
  const ua = navigator.userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|ipod|mobile/.test(ua);
  setK5Available(isMobile);
}

/**
 * Build the callback URL for K5 to return to after delegation.
 * Uses the current page URL with a hash fragment for the delegation result.
 */
function buildCallbackUrl(): string {
  const base = window.location.origin + window.location.pathname;
  return encodeURIComponent(`${base}#/wallet/k5-callback`);
}

/**
 * Initiate K5 wallet connection via deep link.
 *
 * 1. Generates a device keypair in the browser vault
 * 2. Opens the K5 deep link to request device delegation
 * 3. K5 will sign a delegateDevice TX on-chain
 * 4. User returns via callback URL
 *
 * @returns The device public key hex (to track the pending delegation)
 */
export async function initiateK5Connection(): Promise<string> {
  setK5Connecting(true);
  setK5DelegationPending(true);

  // Generate the device key in its OWN vault slot (never touches a built-in wallet)
  const signer = await deviceVaultGenerate();
  if (!signer) {
    setK5Connecting(false);
    throw new Error('Failed to generate device key');
  }

  const devicePubKeyHex = signer.publicKeyHex;
  const callback = buildCallbackUrl();

  // Permission bitmask: messages + channels + profile = 0x07
  const permissions = '07';
  // No expiry (permanent delegation)
  const expiresAt = '0';

  // Build the deep link URL
  const deepLink = `klever://delegate?device_key=${devicePubKeyHex}&permissions=${permissions}&expires_at=${expiresAt}&callback=${callback}`;

  // Open K5 wallet
  window.location.href = deepLink;

  setK5Connecting(false);
  return devicePubKeyHex;
}

/**
 * Check if we're returning from a K5 delegation callback.
 * Called on app init to handle the return flow.
 */
export function checkK5Callback(): boolean {
  const hash = window.location.hash;
  return hash.startsWith('#/wallet/k5-callback');
}
