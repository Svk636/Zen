/**
 * sw.js — Zen Journal Service Worker
 * ─────────────────────────────────────────────────────────────
 * Strategy overview:
 *   • App shell (HTML, CSS, JS, icons, manifest) → Cache-First
 *     with background revalidation (stale-while-revalidate)
 *   • Supabase API calls → Network-First with 4 s timeout,
 *     falls back to cache for GET requests
 *   • Everything else → Network-only (no accidental caching of
 *     third-party or auth traffic)
 *
 * Update flow:
 *   • New SW installs immediately (skipWaiting)
 *   • Notifies all clients → app shows "Update available" toast
 *   • User taps "Update" → clients reload via postMessage
 *
 * Cache hygiene:
 *   • Old cache versions are deleted on activation
 *   • No unbounded cache growth: only SHELL_FILES are precached;
 *     runtime cache is bounded to RUNTIME_MAX_ENTRIES entries
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

// ── Cache names ────────────────────────────────────────────────
const APP_VERSION   = 'v2';           // bump on every deploy
const SHELL_CACHE   = `zen-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `zen-runtime-${APP_VERSION}`;
const ALL_CACHES    = [SHELL_CACHE, RUNTIME_CACHE];

// ── Runtime cache limits ───────────────────────────────────────
const RUNTIME_MAX_ENTRIES = 60;      // max cached responses
const NETWORK_TIMEOUT_MS  = 4000;    // Supabase timeout before cache fallback

// ── App shell: files to precache on install ───────────────────
// Adjust this list to match your actual filenames.
// Using './' for the HTML entry-point works even if the user
// opens the root URL or a subfolder.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
];

// ── Helpers ────────────────────────────────────────────────────

/**
 * Fetch with a hard timeout. Rejects with a TypeError (same as
 * a real network failure) if the request takes too long.
 */
function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const req = new Request(request, { signal: controller.signal });
  return fetch(req).finally(() => clearTimeout(timer));
}

/**
 * Trim a Cache to at most `maxEntries` responses.
 * Removes oldest entries first (FIFO via cache.keys() order).
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
}

/** Broadcast a message to all controlled clients. */
function broadcastToClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true })
    .then(clients => clients.forEach(c => c.postMessage(msg)));
}

// ── Install ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())   // activate immediately
      .catch(err => {
        // Don't let a single missing file block the whole install.
        console.warn('[SW] Shell precache error (non-fatal):', err);
        return self.skipWaiting();
      })
  );
});

// ── Activate ───────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !ALL_CACHES.includes(k))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())  // take control immediately
      .then(() => broadcastToClients({ type: 'SW_ACTIVATED', version: APP_VERSION }))
  );
});

// ── Fetch ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests → always network-only (POST/PUT/DELETE etc.)
  if (request.method !== 'GET') return;

  // 2. Cross-origin non-Supabase requests → pass through
  const isSupabase = url.hostname.endsWith('.supabase.co');
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin && !isSupabase) return;

  // 3. Supabase API → Network-First with timeout, cache fallback
  if (isSupabase) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // 4. App shell (navigation + static assets) → Cache-First with
  //    background revalidation
  event.respondWith(cacheFirstStrategy(request));
});

/**
 * Cache-First with background revalidation (stale-while-revalidate).
 * Serves cached content instantly; fetches fresh copy in background
 * and updates the cache for next time.
 */
async function cacheFirstStrategy(request) {
  const cache    = await caches.open(SHELL_CACHE);
  const cached   = await cache.match(request);

  // Serve from cache immediately, revalidate in background
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);  // ignore background failures

  if (cached) {
    // Trigger background update without awaiting it
    event && networkFetch;
    return cached;
  }

  // Not in cache yet — wait for network
  const networkResponse = await fetch(request).catch(() => null);
  if (networkResponse && networkResponse.ok) {
    cache.put(request, networkResponse.clone());
    return networkResponse;
  }

  // Total failure — return a minimal offline fallback for navigation
  if (request.mode === 'navigate') {
    const offlineFallback = await cache.match('./') ||
                            await cache.match('./index.html');
    if (offlineFallback) return offlineFallback;
  }

  // Nothing we can do
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

/**
 * Network-First with hard timeout.
 * Used for Supabase GET requests — always tries fresh data first,
 * falls back to cache if network is slow or unavailable.
 */
async function networkFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES);
    }
    return response;
  } catch {
    // Network failed or timed out — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // Nothing cached — return a structured error response
    return new Response(
      JSON.stringify({ error: true, message: 'You appear to be offline.' }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ── Message handler ────────────────────────────────────────────
// The app sends messages to control the SW lifecycle.
self.addEventListener('message', event => {
  const { data } = event;
  if (!data || !data.type) return;

  switch (data.type) {
    // App requests version info
    case 'GET_VERSION':
      event.source && event.source.postMessage({
        type: 'SW_VERSION',
        version: APP_VERSION,
        caches: ALL_CACHES,
      });
      break;

    // App triggers update: skip waiting then tell all clients to reload
    case 'SKIP_WAITING':
      self.skipWaiting().then(() => {
        broadcastToClients({ type: 'RELOAD_PAGE' });
      });
      break;

    // App requests cache purge (e.g. on sign-out)
    case 'CLEAR_CACHE':
      Promise.all(ALL_CACHES.map(c => caches.delete(c)))
        .then(() => {
          event.source && event.source.postMessage({ type: 'CACHE_CLEARED' });
        });
      break;

    default:
      break;
  }
});

// ── Push notifications (stub) ──────────────────────────────────
// Uncomment and expand if you add push notifications later.
//
// self.addEventListener('push', event => {
//   const data = event.data ? event.data.json() : {};
//   event.waitUntil(
//     self.registration.showNotification(data.title || 'Zen Journal', {
//       body: data.body || '',
//       icon: 'icons/icon-192.png',
//       badge: 'icons/icon-72.png',
//     })
//   );
// });
//
// self.addEventListener('notificationclick', event => {
//   event.notification.close();
//   event.waitUntil(clients.openWindow('./'));
// });
