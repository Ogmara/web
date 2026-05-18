/**
 * Ogmara SDK integration — shared client instance.
 */

import { OgmaraClient, DEFAULT_NODE_URL, discoverAndPingNodes, pingNode, type NodeWithPing } from '@ogmara/sdk';
import { getSetting, setSetting } from './settings';

let client: OgmaraClient | null = null;

/**
 * URLs that point at the website (or other non-node hosts) but were ever
 * written into the saved nodeUrl. Pre-SDK 0.13.1 the DEFAULT_NODE_URL was
 * `https://ogmara.org` (the marketing site, not a node); existing browsers
 * still carry that value in localStorage. Any saved nodeUrl matching one
 * of these gets reset on the next read so the client doesn't keep hitting
 * a non-node host.
 */
const STALE_NODE_URLS = new Set([
  'https://ogmara.org',
  'https://ogmara.org/',
  'http://ogmara.org',
  'http://ogmara.org/',
]);

/** Discard saved nodeUrl values that point at known non-node hosts. */
function migrateStaleNodeUrl(): void {
  const saved = getSetting('nodeUrl');
  if (saved && STALE_NODE_URLS.has(saved)) {
    // eslint-disable-next-line no-console
    console.info('[api] Resetting stale nodeUrl', saved, '→ default');
    setSetting('nodeUrl', '');
  }
}

/** In dev mode, route API calls through the Vite dev proxy to avoid CORS. */
function resolveNodeUrl(): string {
  migrateStaleNodeUrl();
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

/** Get the user's persisted list of known node URLs (manually added).
 *  Merged with the default + discovered list by `getAvailableNodes`. */
export function getKnownNodes(): string[] {
  return getSetting('knownNodes') ?? [];
}

/** Append a URL to the known-nodes list if not already there. */
export function addKnownNode(url: string): void {
  const existing = getKnownNodes();
  if (!existing.includes(url)) {
    setSetting('knownNodes', [...existing, url]);
  }
}

/** Remove a URL from the known-nodes list (✕ button in picker). */
export function removeKnownNode(url: string): void {
  const existing = getKnownNodes();
  setSetting('knownNodes', existing.filter((u) => u !== url));
}

/**
 * Switch to a different node URL.
 *
 * Persists the URL, remembers it in `knownNodes`, resets the HTTP
 * client AND the WebSocket so push events follow the new node — the
 * cached WS subscription would otherwise keep streaming from the old
 * one and mask the switch from the user.
 */
export function switchNode(nodeUrl: string): void {
  setSetting('nodeUrl', nodeUrl);
  addKnownNode(nodeUrl);
  resetClient();
  // Reset WS so push events follow the new node. Lazy import to break
  // the api.ts ↔ ws.ts circular dependency.
  import('./ws').then(({ closeWs }) => {
    closeWs();
  }).catch(() => { /* ws module optional at boot */ });
  // Force a full page reload so every `createResource` in the app
  // refetches against the new node. Without this, channels / news /
  // profile / DMs all keep showing the previous node's cached
  // payload until the user manually reloads. The setSetting +
  // addKnownNode above are synchronous localStorage writes, so the
  // new node URL persists before reload kicks in.
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/** Get the current node URL. */
export function getCurrentNodeUrl(): string {
  migrateStaleNodeUrl();
  return getSetting('nodeUrl') || DEFAULT_NODE_URL;
}

/** Discover available nodes with ping times, sorted by latency.
 *
 * Web client does NOT pass `allowPrivateHosts` — the SDK's SSRF
 * block stays on because a hosted page making requests to private
 * IPs IS a real attack surface (DNS rebinding, browser-side SSRF).
 * Desktop is local code so it opts in; web does not.
 *
 * The returned list is the UNION of three sources, deduplicated by
 * URL hostname and with the current node winning any tie:
 *
 * 1. `discoverAndPingNodes` — pings current node + any peers it
 *    advertises in `/api/v1/network/nodes`.
 * 2. `DEFAULT_NODE_URL` — SDK hardcoded fallback. Always pingable.
 * 3. `knownNodes` — every URL the user has successfully switched
 *    to in the past. Solves the "switched to a new node and the
 *    previous one disappeared from the dropdown" UX trap.
 *
 * Hostname-level dedup hides duplicate entries when a node's
 * `public_url` is misconfigured (advertises itself under a wrong
 * scheme/port). Current URL always wins; otherwise lowest ping wins.
 */
export async function getAvailableNodes(): Promise<NodeWithPing[]> {
  // In dev mode, skip live discovery (direct fetch to upstream triggers CORS)
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isLocal) {
    return [{ url: getCurrentNodeUrl(), ping: 0 }];
  }
  const currentUrl = getCurrentNodeUrl();
  const discovered = await discoverAndPingNodes(currentUrl);

  const discoveredUrls = new Set(discovered.map((n) => n.url));
  const extras: string[] = [];
  if (!discoveredUrls.has(DEFAULT_NODE_URL) && DEFAULT_NODE_URL !== currentUrl) {
    extras.push(DEFAULT_NODE_URL);
  }
  for (const url of getKnownNodes()) {
    if (!discoveredUrls.has(url) && url !== DEFAULT_NODE_URL && url !== currentUrl) {
      extras.push(url);
    }
  }
  const extraPings = await Promise.all(
    extras.map(async (url) => ({ url, ping: await pingNode(url) })),
  );

  // Hostname-level dedup — drop duplicate rows when a node's
  // `public_url` is misconfigured. Current URL always wins; otherwise
  // pick the lowest ping.
  const merged = [...discovered, ...extraPings];
  const byHost = new Map<string, typeof merged[number]>();
  for (const n of merged) {
    let host: string;
    try { host = new URL(n.url).hostname; } catch { host = n.url; }
    const existing = byHost.get(host);
    if (!existing) { byHost.set(host, n); continue; }
    if (n.url === currentUrl) { byHost.set(host, n); continue; }
    if (existing.url === currentUrl) { continue; }
    if (n.ping < existing.ping) byHost.set(host, n);
  }
  return [...byHost.values()];
}
