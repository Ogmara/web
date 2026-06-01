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
  switchNodeSilent(nodeUrl);
  // Force a full page reload so every `createResource` in the app
  // refetches against the new node. Without this, channels / news /
  // profile / DMs all keep showing the previous node's cached
  // payload until the user manually reloads. The setSetting +
  // addKnownNode in `switchNodeSilent` above are synchronous
  // localStorage writes, so the new node URL persists before
  // reload kicks in.
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/**
 * Silent variant — switches the active node WITHOUT a page reload.
 * Used by [`bootstrapNodeSelection`] to land on the chosen node
 * before any component has mounted, so no `createResource` has yet
 * cached the previous node's payload.
 *
 * Never call from user-driven UI — components built against the
 * previous node won't refetch on their own. Use `switchNode` there.
 */
export function switchNodeSilent(nodeUrl: string): void {
  setSetting('nodeUrl', nodeUrl);
  addKnownNode(nodeUrl);
  resetClient();
  import('./ws').then(({ closeWs }) => {
    closeWs();
  }).catch(() => { /* ws module optional at boot */ });
}

/**
 * User-pinned "always connect here first" node URL (v0.36.0+).
 *
 * Empty string = no pin → [`bootstrapNodeSelection`] picks the
 * lowest-ping node at boot.
 */
export function getDefaultNodeUrl(): string {
  return getSetting('defaultNodeUrl') || '';
}

/**
 * Pin (or clear) the always-connect-here-first node URL. Pass an
 * empty string or `null` to clear the pin and revert to best-ping
 * selection on the next boot. Pinning a URL also adds it to
 * `knownNodes` so the picker keeps surfacing it.
 */
export function setDefaultNodeUrl(url: string | null): void {
  const v = url ?? '';
  setSetting('defaultNodeUrl', v);
  if (v) addKnownNode(v);
}

/**
 * Boot-time node-selection driver (v0.36.0+ / spec 5 §1.1).
 *
 * Decision tree:
 *   1. If `defaultNodeUrl` is pinned: try it with a 3 s ping timeout.
 *      Reach? → land on it. Unreachable? → fall through with a
 *      `default-unreachable-fallback` reason on the result so the
 *      UI can surface a one-time notice.
 *   2. Otherwise (or after step 1's fallback): ping every candidate
 *      from `getAvailableNodes()`, pick the lowest finite ping.
 *   3. If no candidate is reachable, leave `nodeUrl` as-is and
 *      return `no-candidates` — the app will show a "Network
 *      unavailable" placeholder via the usual error path.
 *
 * Must be called BEFORE any `getClient()` use that fetches data —
 * otherwise components will mount against `nodeUrl`'s pre-boot value
 * and only update after a reload. In `src/index.tsx` it's the
 * first awaited call.
 */
export type BootstrapReason =
  | 'default'
  | 'default-unreachable-fallback'
  | 'best-ping'
  | 'no-candidates';

export interface BootstrapResult {
  chosen: string;
  reason: BootstrapReason;
}

let _lastBootstrapResult: BootstrapResult | null = null;

/**
 * Returns the most recent boot-time selection result, or `null` if
 * boot hasn't completed yet. Picker UIs use this to surface a one-
 * time notice when the pinned default was unreachable.
 */
export function getLastBootstrapResult(): BootstrapResult | null {
  return _lastBootstrapResult;
}

export async function bootstrapNodeSelection(): Promise<BootstrapResult> {
  // Dev-mode shortcut: when running under Vite on localhost, the dev
  // proxy is the only sensible target — skip discovery entirely.
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isLocal) {
    const result: BootstrapResult = { chosen: getCurrentNodeUrl(), reason: 'best-ping' };
    _lastBootstrapResult = result;
    return result;
  }

  const pinned = getDefaultNodeUrl();
  if (pinned) {
    const ping = await pingNode(pinned, 3000);
    if (ping !== Infinity) {
      if (pinned !== getCurrentNodeUrl()) switchNodeSilent(pinned);
      const result: BootstrapResult = { chosen: pinned, reason: 'default' };
      _lastBootstrapResult = result;
      return result;
    }
    // Fall through to best-ping with the default-fallback reason.
  }

  const candidates = await getAvailableNodes().catch(() => [] as NodeWithPing[]);
  const reachable = candidates.filter((c) => c.ping !== Infinity);
  if (reachable.length > 0) {
    reachable.sort((a, b) => a.ping - b.ping);
    const best = reachable[0].url;
    if (best !== getCurrentNodeUrl()) switchNodeSilent(best);
    const result: BootstrapResult = {
      chosen: best,
      reason: pinned ? 'default-unreachable-fallback' : 'best-ping',
    };
    _lastBootstrapResult = result;
    return result;
  }
  const result: BootstrapResult = { chosen: getCurrentNodeUrl(), reason: 'no-candidates' };
  _lastBootstrapResult = result;
  return result;
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
