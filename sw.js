// ═══════════════════════════════════════════════════════════════════════════════
//  झेन जर्नल — Service Worker  (sw.js)
//  Strategy: Cache-First for static assets, Network-Only for API/Supabase
//  Messages:  SKIP_WAITING → activate new SW immediately
//  Sync tag:  'zj-sync'    → posts ZJ_FLUSH_QUEUE to all clients
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'zj-v3';
const FONT_CACHE = 'zj-fonts-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const NETWORK_ONLY_ORIGINS = [
  'supabase.co',
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed:', err))
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => { console.info('[SW] Purging old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Always go to network for API / Supabase calls
  if (NETWORK_ONLY_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(fetch(request));
    return;
  }

  // Google Fonts — separate long-lived cache
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(_cacheFirst(request, FONT_CACHE));
    return;
  }

  // Other cross-origin (CDN scripts etc.) — network with cache fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Same-origin assets — cache-first
  event.respondWith(_cacheFirst(request, CACHE_NAME));
});

async function _cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// ── Message ───────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'zj-sync') {
    event.waitUntil(_notifyClients());
  }
});

// Periodic Background Sync (Chrome Android)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'zj-periodic-sync') {
    event.waitUntil(_notifyClients());
  }
});

async function _notifyClients() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: 'ZJ_FLUSH_QUEUE' }));
}
