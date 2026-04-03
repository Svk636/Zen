// ═══════════════════════════════════════════════════════════════════
//  ZenJournal — Service Worker  (sw.js)
//  Strategy : Cache-first for app shell; network-first for API calls
//  Background Sync : 'zj-sync' tag triggers a flush message to client
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME  = 'zj-v4';          // bump this string on every deploy
const SYNC_TAG    = 'zj-sync';
const FLUSH_MSG   = 'ZJ_FLUSH_QUEUE'; // must match index.html SW message handler

// App-shell files that must be available offline
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  // icons
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  // Google Fonts — these are external; skip if you self-host fonts
  // 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond...'
];

// Domains we always fetch live (never serve stale)
const PASSTHROUGH = [
  'supabase.co',
  'googleapis.com',
  'openai.com',
  'anthropic.com',
  'groq.com',
];

// ── Install: precache the app shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// ── Activate: purge old caches ───────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs
  );
});

// ── Fetch: cache-first for app shell; passthrough for API ────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin API calls
  if (request.method !== 'GET') return;
  if (PASSTHROUGH.some(d => url.hostname.includes(d))) return;
  // Skip chrome-extension and non-http(s)
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache valid same-origin responses
        if (
          !response ||
          response.status !== 200 ||
          response.type === 'opaque' ||
          url.origin !== self.location.origin
        ) {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // Offline fallback — serve index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Message: handle SKIP_WAITING from update toast ───────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Background Sync: notify open tabs to flush the offline queue ─────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClients());
  }
});

async function notifyClients() {
  const allClients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });
  allClients.forEach(client => {
    client.postMessage({ type: FLUSH_MSG });
  });
}

// ── Periodic Background Sync (Chrome 80+) ────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClients());
  }
});
