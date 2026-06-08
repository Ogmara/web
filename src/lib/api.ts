/**
 * Ogmara SDK integration — shared client instance.
 */

import { createSignal } from 'solid-js';
import { OgmaraClient, DEFAULT_NODE_URL, discoverAndPingNodes, pingNode, validateNodeUrl, type NodeWithPing } from '@ogmara/sdk';
import { getSetting, setSetting } from './settings';
import { getActiveSigner } from './signerRef';

let client: OgmaraClient | null = null;

/**
 * Reactive mirror of the active node URL. localStorage reads aren't reactive
 * in Solid, and `bootstrapNodeSelection()` lands a node via `switchNodeSilent`
 * WITHOUT a reload — so the picker's current-node label (which read the URL
 * once at mount) showed blank until a manual switch. Components read this
 * signal so the label updates the moment bootstrap (or any silent switch)
 * settles on a node. Kept in lockstep with `setSetting('nodeUrl', …)`.
 *
 * Initialized inline (NOT via `getCurrentNodeUrl()`) — calling that at module
 * eval reaches `STALE_NODE_URLS` / `resolveNodeUrl`, which are declared below
 * this line, and reading a `const` before its declaration runs is a temporal
 * dead-zone crash ("Cannot access … before initialization"). The dev-proxy
 * origin on localhost else saved-node else '' mirrors `resolveNodeUrl`'s
 * initial value without the stale-URL migration (which `getClient` still runs
 * lazily on first use).
 */
const [activeNodeUrl, setActiveNodeUrl] = createSignal(
  getSetting('nodeUrl') ||
    (typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? window.location.origin
      : ''),
);
export { activeNodeUrl };

/** Cold-boot bootstrap: fetch a SAME-ORIGIN node list the website serves
 *  (e.g. `ogmara.org/nodes.json`). This gives a fresh browser its first node
 *  WITHOUT calling Klever's RPC directly (which is CORS-blocked + rate-limited)
 *  and WITHOUT a hardcoded node domain baked into the app — anyone self-hosting
 *  the app ships their own list. Once a node is reached, `discoverAndPingNodes`
 *  (the node's `/network/nodes`, SC-derived server-side) takes over. Returns
 *  validated node URLs; best-effort (empty on any error). Accepts either a JSON
 *  array of URL strings or `{ "nodes": ["..."] }`. */
async function fetchBootstrapNodes(): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  try {
    const resp = await fetch(`${window.location.origin}/nodes.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const raw: unknown[] = Array.isArray(data) ? data : (data?.nodes ?? []);
    return raw.filter(
      (u): u is string => typeof u === 'string' && Boolean(validateNodeUrl(u)),
    );
  } catch {
    return [];
  }
}

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
  // On localhost the dev proxy forwards /api/v1/* to the upstream node.
  // Otherwise there's NO hardcoded seed anymore — the node comes from
  // on-chain SC discovery via `bootstrapNodeSelection()`. Empty until it
  // lands one; calls fail (caught by views) in the meantime.
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return isLocal ? window.location.origin : '';
}

/**
 * Get or create the shared API client.
 *
 * The signer is RE-ATTACHED on every (re)creation from the vault's
 * in-memory signer. This decouples signer lifetime from client lifetime:
 * any `resetClient()` (every node switch) used to silently drop the
 * signer, so the next authenticated call threw "Signer required for
 * authenticated endpoints". At boot it raced — `bootstrapNodeSelection()`
 * runs concurrently with `initAuth()` and can `resetClient()` AFTER the
 * signer was attached. Re-reading the vault signer here makes the client
 * robust regardless of reset ordering (null when locked/disconnected).
 */
export function getClient(): OgmaraClient {
  if (!client) {
    client = new OgmaraClient({ nodeUrl: resolveNodeUrl() });
    const signer = getActiveSigner();
    if (signer) client.withSigner(signer);
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
  // Mark this as an EXPLICIT user choice so the post-reload
  // `bootstrapNodeSelection()` honors it instead of re-running best-ping
  // (or pinned-default) selection and bouncing the user onto a different
  // node. Without this a manual switch never stuck (the reload re-ran
  // selection). Survives the reload via sessionStorage; consumed at boot.
  try {
    sessionStorage.setItem('ogmara:explicitNode', nodeUrl);
  } catch {
    /* sessionStorage unavailable — fall back to best-ping after reload */
  }
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
  // Validate at this single chokepoint so EVERY switch path — picker,
  // manual-add, pinned, best-ping, explicit-flag — is covered. A
  // compromised current node can advertise arbitrary peer URLs; web does
  // NOT allow private hosts (browser SSRF), so this also blocks loopback/
  // RFC1918/etc. URLs from being switched to. Keep current node on reject.
  if (!validateNodeUrl(nodeUrl)) {
    return;
  }
  setSetting('nodeUrl', nodeUrl);
  setActiveNodeUrl(nodeUrl); // keep the reactive label in sync
  addKnownNode(nodeUrl);
  resetClient();
  // RECONNECT (not just close) the WebSocket so push events follow the new
  // node — but only when a socket is already live. At cold boot the
  // connection is owned by the auth/init path; a concurrent bootstrap
  // switch must not open its own (possibly anonymous) socket and race it.
  // `initWs()` closes any existing socket first.
  import('./ws').then(({ initWs, wsIsActive }) => {
    if (wsIsActive()) initWs(getActiveSigner() ?? undefined);
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

// Reactive so the no-node landing gate can tell "boot still running" (null)
// from "boot finished, no node found" (a result with reason 'no-candidates').
const [lastBootstrapResult, setLastBootstrapResult] = createSignal<BootstrapResult | null>(null);

/**
 * Returns the most recent boot-time selection result, or `null` if
 * boot hasn't completed yet. Picker UIs use this to surface a one-
 * time notice when the pinned default was unreachable. Reactive.
 */
export function getLastBootstrapResult(): BootstrapResult | null {
  return lastBootstrapResult();
}

export async function bootstrapNodeSelection(): Promise<BootstrapResult> {
  // One-time cleanup: purge the deprecated hardcoded seed
  // (`node.ogmara.org`) from persisted known-nodes if present. It's now
  // dead and used to linger in the picker as an unremovable ∞ row.
  removeKnownNode(DEFAULT_NODE_URL);

  // Dev-mode shortcut: when running under Vite on localhost, the dev
  // proxy is the only sensible target — skip discovery entirely.
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isLocal) {
    const result: BootstrapResult = { chosen: getCurrentNodeUrl(), reason: 'best-ping' };
    setLastBootstrapResult(result);
    return result;
  }

  // An explicit user switch (picker / manual-add) triggers a reload, which
  // re-enters this function. Honor that choice verbatim — skip pin +
  // best-ping — so the user lands on the node they picked. One-shot flag.
  let explicit = '';
  try {
    explicit = sessionStorage.getItem('ogmara:explicitNode') || '';
    if (explicit) sessionStorage.removeItem('ogmara:explicitNode');
  } catch {
    /* sessionStorage unavailable — fall through to normal selection */
  }
  if (explicit) {
    if (explicit !== getCurrentNodeUrl()) switchNodeSilent(explicit);
    const result: BootstrapResult = { chosen: explicit, reason: 'default' };
    setLastBootstrapResult(result);
    return result;
  }

  const pinned = getDefaultNodeUrl();
  if (pinned) {
    const ping = await pingNode(pinned, 3000);
    if (ping !== Infinity) {
      if (pinned !== getCurrentNodeUrl()) switchNodeSilent(pinned);
      const result: BootstrapResult = { chosen: pinned, reason: 'default' };
      setLastBootstrapResult(result);
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
    setLastBootstrapResult(result);
    return result;
  }
  const result: BootstrapResult = { chosen: getCurrentNodeUrl(), reason: 'no-candidates' };
  setLastBootstrapResult(result);
  return result;
}

/** Get the current node URL (dev-proxy origin on localhost, else the saved
 *  node, else '' until SC discovery / a saved node lands one). */
export function getCurrentNodeUrl(): string {
  return resolveNodeUrl();
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
 *    advertises in `/api/v1/network/nodes`. Skipped when there's no
 *    current node yet.
 * 2. `discoverNodesViaSc` — the ON-CHAIN registry (getActiveNodes →
 *    getNodeMetadata → derived HTTPS endpoint), with a 7-day anchor-
 *    staleness filter. This REPLACED the dead hardcoded
 *    `DEFAULT_NODE_URL` (`node.ogmara.org`) seed — a single point of
 *    failure that cluttered the picker as a permanently-∞ row.
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
  const discovered = currentUrl
    ? await discoverAndPingNodes(currentUrl).catch(() => [] as NodeWithPing[])
    : [];

  const discoveredUrls = new Set(discovered.map((n) => n.url));
  // The browser must NEVER call Klever's RPC directly — it is CORS-blocked
  // (no Access-Control-Allow-Origin) and rate-limited (429). Node discovery
  // instead comes from the connected node's `/network/nodes`
  // (`discoverAndPingNodes` above), which the NODE derives from the SC
  // registry server-side. For COLD boot (no node reached yet) we seed from a
  // same-origin bootstrap list the website serves — no hardcoded node domain
  // in the app, and anyone self-hosting ships their own list. Plus every
  // user-added URL.
  const bootstrapUrls = await fetchBootstrapNodes().catch(() => [] as string[]);
  const extras: string[] = [];
  const pushExtra = (url: string) => {
    if (!url || discoveredUrls.has(url) || url === currentUrl || extras.includes(url)) {
      return;
    }
    extras.push(url);
  };
  for (const url of bootstrapUrls) pushExtra(url);
  for (const url of getKnownNodes()) pushExtra(url);

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
