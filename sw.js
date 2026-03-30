/**
 * sw.js — झेन जर्नल Service Worker
 * Strategy: Cache-first for app shell, network-first for Supabase/AI APIs.
 * GitHub Pages compatible: uses relative paths, dynamic scope detection.
 */

const CACHE_VERSION = 'zj-v6';
const SHELL_CACHE   = CACHE_VERSION + '-shell';
const DATA_CACHE    = CACHE_VERSION + '-data';

// ── App shell: files to precache on install ───────────────────────────────
// Only files that actually exist in the repo. Icons are optional — SW won't
// break if they're missing (install uses individual try/catch per asset).
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
];

// ── Origins that must always go to the network (APIs) ────────────────────
const NETWORK_ONLY_ORIGINS = [
  'supabase.co',
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
];

// ── Install: cache shell assets ───────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async cache => {
      // Cache each asset individually so one missing file doesn't abort all
      for (const url of SHELL_ASSETS) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('[SW] Could not cache:', url, e.message);
        }
      }
    })
    // skipWaiting() is intentionally NOT called here.
    // The main page sends SKIP_WAITING when the user clicks "Update" in the toast.
  );
});

// ── Activate: remove stale caches ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET → always network (POST/PUT mutations must not be cached)
  if (request.method !== 'GET') return;

  // 2. Chrome extension / non-http(s) → ignore
  if (!url.protocol.startsWith('http')) return;

  // 3. External API origins → network-only, no cache fallback
  if (NETWORK_ONLY_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(fetch(request));
    return;
  }

  // 4. Same-origin navigation (page loads) → cache-first, fall back to index
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./').then(cached => {
        if (cached) return cached;
        return fetch(request).catch(() => caches.match('./'));
      })
    );
    return;
  }

  // 5. All other same-origin requests (JS, CSS, images) → cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache valid same-origin responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (request.destination === 'document') return caches.match('./');
      });
    })
  );
});

// ── Message: SKIP_WAITING sent by main page update toast ─────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Background Sync: flush Supabase queue when back online ───────────────
self.addEventListener('sync', event => {
  if (event.tag === 'zj-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'ZJ_FLUSH_QUEUE' })
        );
      })
    );
  }
});
