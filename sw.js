// ═══════════════════════════════════════════════════════
//  झेन जर्नल — Service Worker  (GitHub Pages ready)
//  Cache-first for shell assets, network-first for Supabase API
// ═══════════════════════════════════════════════════════

const CACHE_NAME    = 'zen-journal-v2';
const SUPABASE_HOST = 'asduwjszfcauirrhfyaz.supabase.co';

// Assets to pre-cache on install (app shell)
// Icons are optional — if missing, SW install still succeeds
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

const OPTIONAL_CACHE = [
  './icons/favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Critical assets must succeed
      return cache.addAll(PRECACHE_URLS).then(() => {
        // Optional assets (icons): silently ignore failures
        return Promise.allSettled(
          OPTIONAL_CACHE.map(url =>
            cache.add(url).catch(() => { /* icon missing — ok */ })
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Supabase API calls → network-only
  if (url.hostname === SUPABASE_HOST) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Non-GET requests → network-only
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // 3. External CDN (jsPDF etc.) → network-first, cache fallback
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 4. App shell (same-origin) → cache-first, network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── Message: handle SKIP_WAITING from main page ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Background Sync: flush queued journal entries ──
self.addEventListener('sync', event => {
  if (event.tag === 'zj-sync-entries') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'SW_SYNC_TRIGGER' })
        );
      })
    );
  }
});
