/**
 * Ogmara SDK integration — shared client instance.
 */

import { OgmaraClient, DEFAULT_NODE_URL, discoverAndPingNodes, type NodeWithPing } from '@ogmara/sdk';
import { getSetting, setSetting } from './settings';

let client: OgmaraClient | null = null;

/** In dev mode, route API calls through the Vite dev proxy to avoid CORS. */
function resolveNodeUrl(): string {
  const saved = getSetting('nodeUrl');
  if (saved) return saved;
  // On localhost the dev proxy forwards /api/v1/* to the upstream node
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return isLocal ? window.location.origin : DEFAULT_NODE_URL;
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

/** Get the current node URL. */
export function getCurrentNodeUrl(): string {
  return getSetting('nodeUrl') || DEFAULT_NODE_URL;
}

/** Discover available nodes with ping times, sorted by latency. */
export async function getAvailableNodes(): Promise<NodeWithPing[]> {
  const currentUrl = getCurrentNodeUrl();
  return discoverAndPingNodes(currentUrl);
}
