/**
 * Ogmara PWA Service Worker — network-first for HTML, cache-first for hashed assets.
 */

const CACHE_NAME = 'ogmara-v1';
const APP_SHELL = ['/app/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

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
