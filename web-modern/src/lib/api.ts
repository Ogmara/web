/**
 * Ogmara SDK integration — shared client instance.
 */

import { OgmaraClient, DEFAULT_NODE_URL, discoverAndPingNodes, type NodeWithPing } from '@ogmara/sdk';
import { getSetting, setSetting } from './settings';

let client: OgmaraClient | null = null;

/**
 * Resolve the node URL the SDK should use for fetches and WebSockets.
 *
 * In dev mode (vite dev server), we route everything through the dev server
 * origin so Vite's proxy (see vite.config.ts) can forward requests upstream
 * and avoid CORS. The user-visible "node URL" still points at the real
 * upstream node — only the SDK's transport target changes.
 */
function resolveNodeUrl(): string {
  const userPick = getSetting('nodeUrl');
  if (import.meta.env.DEV) {
    // In development, force same-origin requests so they hit the Vite proxy.
    // `window.location.origin` = e.g. "http://localhost:5173".
    if (typeof window !== 'undefined') return window.location.origin;
  }
  return userPick || DEFAULT_NODE_URL;
}

/** Get or create the shared API client. */
export function getClient(): OgmaraClient {
  if (!client) {
    client = new OgmaraClient({ nodeUrl: resolveNodeUrl() });
  }
  return client;
}

/** Reset the client (e.g., when node URL changes). */
export function resetClient(): void {
  client = null;
}

/** Switch to a different node URL. */
export function switchNode(nodeUrl: string): void {
  setSetting('nodeUrl', nodeUrl);
  resetClient();
}

/**
 * Get the user-facing node URL — what we *display* in the UI.
 * Always returns the upstream URL the user picked (or the default), even in
 * dev mode where the SDK is actually talking to the local proxy.
 */
export function getCurrentNodeUrl(): string {
  return getSetting('nodeUrl') || DEFAULT_NODE_URL;
}

/** Discover available nodes with ping times, sorted by latency. */
export async function getAvailableNodes(): Promise<NodeWithPing[]> {
  // In dev mode, the SDK is talking to the Vite proxy and the upstream is
  // hardcoded in vite.config.ts. Skip live discovery (which would hit the
  // real upstream URL directly and trigger CORS errors) and just return a
  // single static entry pointing at the user-facing URL.
  if (import.meta.env.DEV) {
    return [{ url: getCurrentNodeUrl(), ping: 0 }];
  }
  const currentUrl = getCurrentNodeUrl();
  return discoverAndPingNodes(currentUrl);
}
