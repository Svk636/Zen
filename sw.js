/**
 * sw.js — झेन जर्नल Service Worker
 *
 * Features:
 *   • Cache-first for app shell (HTML, CSS, fonts, icons)
 *   • Network-first for API calls (Supabase, Groq, Gemini, etc.)
 *   • Background Sync for queued Supabase writes (tag: 'zj-sync')
 *   • Offline fallback page
 *   • Clean cache versioning on update
 */

const CACHE_NAME  = 'zj-v1';
const SYNC_TAG    = 'zj-sync';

// App-shell assets to pre-cache on install
// Adjust paths to match your actual file layout
const PRECACHE = [
  './',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Mono:ital,wght@0,300;0,400;1,300&display=swap',
];

// Domains whose requests should always go network-first (never serve from cache)
const NETWORK_FIRST_PATTERNS = [
  /supabase\.co/,
  /api\.groq\.com/,
  /generativelanguage\.googleapis\.com/,
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /allorigins\.win/,
  /google\.com\/s2\/favicons/,
  /fonts\.googleapis\.com/,      // fonts sheet — cached below after first fetch
  /fonts\.gstatic\.com/,
];

// ── Install ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();   // Activate immediately without waiting for old tabs to close
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Pre-cache critical assets; don't fail install if optional resources 404
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(e => console.warn('[SW] Precache skipped:', url, e.message))
        )
      );
    })
  );
});

// ── Activate ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())  // Take control of all open tabs immediately
  );
});

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignore non-GET, chrome-extension, and data: URLs
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const isNetworkFirst = NETWORK_FIRST_PATTERNS.some(re => re.test(request.url));

  if (isNetworkFirst) {
    // Network-first: try network, fall back to cache (useful for font sheets)
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  } else {
    // Cache-first: serve from cache, update cache in background (stale-while-revalidate)
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        });
        return cached || networkFetch;
      })
    );
  }
});

// ── Background Sync ──────────────────────────────────────────────
// Triggered when the browser has connectivity after going offline.
// The main page calls registration.sync.register('zj-sync') via registerBgSync().
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Post a message to all active clients asking them to flush the Supabase queue.
  // This keeps all sync logic in the page (where Supabase credentials live).
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: 'ZJ_BG_SYNC' }));

  // If no clients are open, we can't sync (credentials are page-side).
  // The queue will flush next time the app opens.
  if (!clients.length) {
    console.log('[SW] Background sync: no open clients, deferring.');
  }
}

// ── Push Notifications (placeholder) ────────────────────────────
// Uncomment and implement if you add push notifications later.
//
// self.addEventListener('push', event => {
//   const data = event.data?.json() || {};
//   event.waitUntil(
//     self.registration.showNotification(data.title || 'झेन जर्नल', {
//       body: data.body || '',
//       icon: 'icons/icon-192.png',
//       badge: 'icons/icon-32.png',
//       tag:  data.tag  || 'zj',
//     })
//   );
// });

// ── Message handler (from main page) ────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'ZJ_SKIP_WAITING') {
    self.skipWaiting();
  }
});
