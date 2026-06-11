/**
 * Network activity tracker — monkey-patches window.fetch to count
 * in-flight requests. Components can read the `pendingRequests` signal
 * (or `isLoading` derivation) to render a loading indicator.
 *
 * The patch is installed once via `installNetworkActivityTracker()` from
 * index.tsx. It only tracks requests to our own L2 node (URLs that
 * include `/api/v1/`) so unrelated fetches (favicon, manifest, etc.)
 * don't trigger the indicator.
 */

import { createSignal } from 'solid-js';

const [pendingRequests, setPendingRequests] = createSignal(0);
export { pendingRequests };

/** True when at least one tracked request is in flight. */
export const isLoading = () => pendingRequests() > 0;

/**
 * True when at least one tracked request has been pending for longer than
 * `slowThresholdMs`. Use this to show a stronger "still working..." hint
 * when the L2 node is unresponsive.
 */
const [slowLoading, setSlowLoading] = createSignal(false);
export { slowLoading };

const SLOW_THRESHOLD_MS = 1500;

let installed = false;

/** Install the global fetch wrapper. Idempotent. */
export function installNetworkActivityTracker(): void {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  let slowTimer: ReturnType<typeof setTimeout> | null = null;

  // Single-flight dedup for concurrent GETs to the node API. A reactive
  // refetch loop (an effect re-firing faster than its fetch resolves, a
  // remount storm, etc.) would otherwise launch hundreds of identical requests
  // — exhausting the browser's socket pool (`ERR_INSUFFICIENT_RESOURCES`) and
  // bursting the node. Collapsing identical in-flight GETs into ONE upstream
  // request makes any such loop harmless at the network layer (the effect may
  // still spin, but it can't flood). Mutations (POST/PUT/DELETE) and anything
  // with a body are never deduped. Each caller gets an independent clone so it
  // can read the body freely.
  const inflightGets = new Map<string, Promise<Response>>();

  const refreshSlowTimer = () => {
    if (slowTimer) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
    if (pendingRequests() > 0) {
      slowTimer = setTimeout(() => {
        if (pendingRequests() > 0) setSlowLoading(true);
      }, SLOW_THRESHOLD_MS);
    } else {
      setSlowLoading(false);
    }
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isTracked = url.includes('/api/v1/');
    const method = (init?.method
      || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')
      || 'GET').toUpperCase();
    // Only dedup idempotent, body-less GETs to the node API — never mutations.
    const dedupable = isTracked && method === 'GET' && !init?.body;

    if (dedupable) {
      const existing = inflightGets.get(url);
      if (existing) {
        // Join the in-flight request; clone so this caller can read the body.
        // Note (audit 2026-06-11): authed GETs are deduped too. The joiner's
        // own fresh nonce is simply DISCARDED (its request never goes upstream)
        // — not burned — so it stays usable; only the originator's nonce hits
        // the node. All requests on a page are signed by the same identity and
        // the key is the exact URL, so there's no cross-identity leak. The only
        // trade-off: a transient error (e.g. a one-off 401) is shared across the
        // joiners of THAT single flight, and joiners forgo their own AbortSignal
        // — both bounded (the entry clears in `.finally`, next call re-fetches).
        return existing.then((r) => r.clone());
      }
    }

    if (isTracked) {
      setPendingRequests((n) => n + 1);
      refreshSlowTimer();
    }

    const run = originalFetch(input, init);
    if (dedupable) {
      inflightGets.set(url, run);
      run.finally(() => {
        if (inflightGets.get(url) === run) inflightGets.delete(url);
      }).catch(() => {});
    }

    try {
      const resp = await run;
      // Return a clone so the shared promise's Response body stays readable for
      // any other caller that joined this single flight.
      return dedupable ? resp.clone() : resp;
    } finally {
      if (isTracked) {
        setPendingRequests((n) => Math.max(0, n - 1));
        refreshSlowTimer();
      }
    }
  };
}
