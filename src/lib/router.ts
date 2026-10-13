/**
 * Hash-based URL router for the Ogmara web app.
 *
 * Uses hash fragments (#/path) to avoid server configuration requirements.
 * Works with static file hosting and Vite dev server.
 *
 * Routes:
 *   #/chat                  — Channel list (default)
 *   #/chat/:channelId       — Channel messages
 *   #/news                  — News feed
 *   #/news/:msgId           — News post detail
 *   #/dm                    — DM conversations list
 *   #/dm/:address           — DM conversation
 *   #/user/:address         — User profile
 *   #/search                — Search
 *   #/search?q=term         — Search with query
 *   #/bookmarks             — Bookmarks
 *   #/settings              — Settings
 *   #/wallet                — Wallet management
 *   #/wallet/k5-callback    — K5 wallet callback
 */

import { createSignal } from 'solid-js';
import { getSetting } from './settings';
import { registerWalletSwitchReset } from './walletScope';

export type ViewName =
  | 'chat'
  | 'news'
  | 'news-detail'
  | 'dm'
  | 'dm-conversation'
  | 'user'
  | 'search'
  | 'bookmarks'
  | 'settings'
  | 'topics-settings'
  | 'wallet'
  | 'compose'
  | 'channel-create'
  | 'channel-settings'
  | 'channel-join'
  | 'notifications'
  | 'follow-list';

export interface Route {
  view: ViewName;
  params: Record<string, string>;
  query: Record<string, string>;
}

function parseHash(hash: string): Route {
  // Remove leading # and /
  const raw = hash.replace(/^#\/?/, '');
  // Split query string
  const [path, queryStr] = raw.split('?');
  const segments = path.split('/').filter(Boolean);

  // Parse query params
  const query: Record<string, string> = {};
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }

  const first = segments[0] || 'news';
  const second = segments[1] || '';
  const third = segments[2] || '';

  switch (first) {
    case 'chat':
      if (second && third === 'settings') {
        return { view: 'channel-settings', params: { channelId: second }, query };
      }
      if (second) {
        return { view: 'chat', params: { channelId: second }, query };
      }
      // No channelId in URL — restore last visited channel if available
      {
        const last = getSetting('lastChannel');
        if (last) {
          return { view: 'chat', params: { channelId: String(last) }, query };
        }
      }
      return { view: 'chat', params: {}, query };

    case 'news':
      if (second) {
        return { view: 'news-detail', params: { msgId: second }, query };
      }
      return { view: 'news', params: {}, query };

    case 'dm':
      if (second) {
        return { view: 'dm-conversation', params: { address: second }, query };
      }
      return { view: 'dm', params: {}, query };

    case 'user':
      if (third === 'followers') {
        return { view: 'follow-list', params: { address: second, tab: 'followers' }, query };
      }
      if (third === 'following') {
        return { view: 'follow-list', params: { address: second, tab: 'following' }, query };
      }
      return { view: 'user', params: { address: second }, query };

    case 'search':
      return { view: 'search', params: {}, query };

    case 'bookmarks':
      return { view: 'bookmarks', params: {}, query };

    case 'notifications':
      return { view: 'notifications', params: {}, query };

    case 'settings':
      // `/settings/topics` is its own view rather than an inline sidebar
      // panel — see `TopicsSettingsView` — so managing topics can be linked
      // to and backed out of like everything else.
      if (second === 'topics') return { view: 'topics-settings', params: {}, query };
      return { view: 'settings', params: {}, query };

    case 'wallet':
      return { view: 'wallet', params: { sub: second }, query };

    case 'compose':
      return { view: 'compose', params: {}, query };

    case 'channel':
      if (second === 'create') {
        return { view: 'channel-create', params: {}, query };
      }
      return { view: 'chat', params: {}, query };

    case 'join':
      return { view: 'channel-join', params: { channelId: second }, query };

    default:
      return { view: 'chat', params: {}, query };
  }
}

const [route, setRoute] = createSignal<Route>(parseHash(window.location.hash));

// Listen for hash changes. An identical route is not re-published (see
// `redirectNow`, which applies its route synchronously before this fires).
window.addEventListener('hashchange', () => {
  const next = parseHash(window.location.hash);
  if (!sameRoute(route(), next)) setRoute(next);
});

/** Structural equality for two parsed routes (view + params + query). */
function sameRoute(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false;
  const eq = (x: Record<string, string>, y: Record<string, string>) => {
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    return kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && x[k] === y[k]);
  };
  return eq(a.params, b.params) && eq(a.query, b.query);
}

// `parseHash` resolves a bare `#/chat` to the ACTIVE account's per-wallet
// `lastChannel`, but only when the hash is parsed. A wallet switch does not
// change the hash, so the route kept pointing at the PREVIOUS account's last
// channel (possibly a private one) until the next navigation. Re-parse on
// every wallet-scope change and publish only a real difference, so an
// unchanged route does not re-trigger every route-dependent effect.
registerWalletSwitchReset(() => {
  const next = parseHash(window.location.hash);
  if (!sameRoute(route(), next)) setRoute(next);
});

export { route };

// Counts in-app navigations since this page load, so goBack() can tell a real
// "came from elsewhere in the app" case apart from a fresh deep link (where
// window.history has entries, but none of them are ours to return to).
let navCount = 0;

/**
 * Replace the current route IMMEDIATELY (no history entry, no wait for the
 * async `hashchange`). Used when the current route must not stay mounted for
 * even one more task — e.g. a previous account's channel/DM after an account
 * change (see lib/accountRoutes.ts).
 */
export function redirectNow(path: string): void {
  const p = path.startsWith('/') ? path : `/${path}`;
  const hash = `#${p}`;
  try {
    window.history.replaceState(window.history.state, '', hash);
  } catch {
    window.location.replace(hash);
  }
  const next = parseHash(hash);
  if (!sameRoute(route(), next)) setRoute(next);
}

/** Navigate to a new route. */
export function navigate(path: string): void {
  navCount++;
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

/**
 * Navigate back to wherever the user actually came from within the app.
 * Falls back to `fallback` when there's no in-app history to return to
 * (e.g. the view was opened via a deep link / page reload).
 */
export function goBack(fallback: string = '/chat'): void {
  if (navCount > 0) {
    navCount--;
    window.history.back();
  } else {
    navigate(fallback);
  }
}

/** Get a route parameter. */
export function routeParam(key: string): string | undefined {
  return route().params[key];
}

/** Get a query parameter. */
export function queryParam(key: string): string | undefined {
  return route().query[key];
}
