/**
 * Push notification integration — Web Push API subscription and
 * push gateway registration.
 *
 * Flow:
 * 1. Fetch VAPID public key from push gateway
 * 2. Subscribe via browser PushManager
 * 3. Register the subscription with the push gateway
 * 4. Service worker handles incoming push events
 */

import { DEFAULT_NODE_URL } from '@ogmara/sdk';
import { getSetting, setSetting } from './settings';
import { getSigner, walletAddress } from './auth';

/** Derive the push gateway URL from configuration. */
export function getPushGatewayUrl(): string {
  const explicit = getSetting('pushGatewayUrl') as string;
  if (explicit) return explicit;

  // Auto-derive: /push path on the node's origin (path-based reverse proxy).
  // Falls back to DEFAULT_NODE_URL if nodeUrl setting is empty.
  const nodeUrl = (getSetting('nodeUrl') as string) || DEFAULT_NODE_URL;
  if (!nodeUrl) return '';

  try {
    const url = new URL(nodeUrl);
    // Default convention: push gateway behind reverse proxy at /push
    return `${url.origin}/push`;
  } catch {
    return '';
  }
}

/** Fetch the VAPID public key from the push gateway. */
async function fetchVapidKey(gatewayUrl: string): Promise<Uint8Array> {
  const resp = await fetch(`${gatewayUrl}/vapid-key`);
  if (!resp.ok) throw new Error(`Failed to fetch VAPID key: ${resp.status}`);
  const data = await resp.json();
  if (!data.publicKey) throw new Error('No publicKey in response');

  // Decode base64url to Uint8Array
  const base64 = data.publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Subscribe to Web Push via the browser PushManager. */
async function subscribeToPush(vapidKey: Uint8Array): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey.buffer as ArrayBuffer,
  });
}

/** Register the push subscription with the push gateway. */
async function registerWithGateway(
  gatewayUrl: string,
  subscription: PushSubscription,
  address: string,
): Promise<void> {
  const signer = getSigner();
  if (!signer) throw new Error('No signer available');

  // Host-bound registration claim (audit 2026-06-07): bind to the gateway URL
  // + a single-use nonce + the exact token. The signing address must equal the
  // body address, so use the address returned by signPushClaim.
  const token = JSON.stringify(subscription.toJSON());
  const { headers: authHeaders, address: signedAddress } =
    await signer.signPushClaim('register', gatewayUrl, token);
  if (signedAddress !== address) {
    // Built-in wallet: signing address == wallet. Delegated device keys can't
    // self-register for a different wallet (gateway rejects) — deferred.
    console.warn('[push] signer address differs from wallet address; gateway will use signer address');
  }

  const resp = await fetch(`${gatewayUrl}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      address: signedAddress,
      token,
      platform: 'web',
      channels: [],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Registration failed: ${resp.status} ${text}`);
  }
}

/** Unregister the push subscription from the push gateway. */
async function unregisterFromGateway(
  gatewayUrl: string,
  subscriptionJson: string,
  address: string,
): Promise<void> {
  const signer = getSigner();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let bodyAddress = address;
  if (signer) {
    const { headers: authHeaders, address: signedAddress } =
      await signer.signPushClaim('unregister', gatewayUrl, subscriptionJson);
    Object.assign(headers, authHeaders);
    bodyAddress = signedAddress;
  }

  await fetch(`${gatewayUrl}/unregister`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      address: bodyAddress,
      token: subscriptionJson,
    }),
  });
}

/**
 * Enable push notifications.
 *
 * Requests browser permission, subscribes via PushManager,
 * and registers the subscription with the push gateway.
 *
 * @returns 'ok' on success, or an error key for i18n display.
 */
export async function enablePush(): Promise<'ok' | 'denied' | 'unsupported' | 'error'> {
  // Check browser support
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }

  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return 'denied';
  }

  const address = walletAddress();
  if (!address) return 'error';

  const gatewayUrl = getPushGatewayUrl();
  if (!gatewayUrl) return 'error';

  try {
    const vapidKey = await fetchVapidKey(gatewayUrl);
    const subscription = await subscribeToPush(vapidKey);
    await registerWithGateway(gatewayUrl, subscription, address);

    setSetting('pushEnabled', true);
    return 'ok';
  } catch (e) {
    console.warn('Push notification setup failed:', e);
    return 'error';
  }
}

/** Disable push notifications and unregister from gateway. */
export async function disablePush(): Promise<void> {
  setSetting('pushEnabled', false);

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const address = walletAddress();
      const gatewayUrl = getPushGatewayUrl();

      if (address && gatewayUrl) {
        await unregisterFromGateway(
          gatewayUrl,
          JSON.stringify(subscription.toJSON()),
          address,
        );
      }

      await subscription.unsubscribe();
    }
  } catch (e) {
    console.warn('Push unsubscribe failed:', e);
  }
}
