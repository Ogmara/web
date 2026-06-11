/**
 * Ogmara PWA Service Worker — network-first for HTML, cache-first for hashed assets.
 */

const CACHE_NAME = 'ogmara-v2';
const APP_SHELL = ['/app/'];

// Dedicated, durable cache for node media (`/api/v1/media/<cid>`). CID content
// is content-addressed → immutable, so we cache it cache-first FOREVER, app-side
// — even though the node is a DIFFERENT origin than the web app. This is what
// stops channel logos / avatars / attachments from re-downloading on every page
// reload: cross-origin <img> isn't reliably held by the browser HTTP cache, and
// the SW otherwise bypasses cross-origin entirely (2026-06-11). Kept in its own
// cache (not purged on app-shell version bumps) with a soft entry cap.
const MEDIA_CACHE = 'ogmara-media-v1';
const MEDIA_CACHE_MAX = 200;

async function trimMediaCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_CACHE_MAX) return;
  // Cache API returns keys in insertion order — drop the oldest overflow.
  for (const k of keys.slice(0, keys.length - MEDIA_CACHE_MAX)) {
    await cache.delete(k);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Media (CID-addressed, immutable) — cache-first, FOREVER, even cross-origin.
  // Must run BEFORE the cross-origin bypass below since the node is a different
  // origin. Only GET; opaque (no-cors) responses are cacheable + displayable,
  // so this works regardless of whether the node sends CORS for media.
  if (
    event.request.method === 'GET' &&
    url.pathname.startsWith('/api/v1/media/') &&
    // Skip range requests (e.g. video seeking) — those want a 206 partial;
    // let them go to the network so we never cache/serve a partial as a full.
    !event.request.headers.has('range')
  ) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const resp = await fetch(event.request);
        // Cache only FULL responses: a CORS 200, or an opaque no-cors response
        // (status 0 — can't introspect, but image <img> loads are never ranged).
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
          cache.put(event.request, resp.clone()).then(() => trimMediaCache(cache)).catch(() => {});
        }
        return resp;
      })
    );
    return;
  }

  // Only handle same-origin requests — never intercept cross-origin fetches
  // (e.g. Klever Extension calling node.klever.org, api.klever.org)
  if (url.origin !== self.location.origin) return;

  // Never cache API calls or WebSocket upgrades
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Network-first for HTML (ensures fresh app on deploy)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/app/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for hashed assets (JS/CSS bundles from Vite)
  if (url.pathname.startsWith('/app/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Static files (favicon, manifest, icons) — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

/**
 * Push notification handler — receives encrypted payloads from the push
 * gateway and displays OS notifications via the Notifications API.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let title = 'Ogmara';
  let options = { body: '', icon: '/app/icon-192.png', tag: 'ogmara', data: {} };

  try {
    const payload = event.data.json();
    if (payload.notification) {
      title = payload.notification.title || title;
      options.body = payload.notification.body || '';
    }
    if (payload.data) {
      options.data = payload.data;
      options.tag = payload.data.msg_id || 'ogmara';
    }
  } catch {
    // Non-JSON payload — use raw text
    options.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Notification click handler — opens the app and navigates to the
 * relevant channel or DM based on the notification's data payload.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let url = '/app/';

  if (data.type === 'mention' && data.channel_id) {
    url = '/app/chat/' + data.channel_id;
  } else if (data.type === 'dm' && data.conversation_id) {
    url = '/app/dm/' + data.conversation_id;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
