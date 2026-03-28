// ═══════════════════════════════════════════════════════
//  ZEN JOURNAL — SERVICE WORKER
//  Strategy:
//    · App shell  → Cache-first (instant load, offline works)
//    · Supabase   → Network-only (auth + data must be live)
//    · Everything else → Stale-while-revalidate
//
//  Background Sync tag: 'zj-sync-entries'
//  SKIP_WAITING message: { type: 'SKIP_WAITING' }
//  SW_SYNC_TRIGGER message → client triggers SB.flush()
// ═══════════════════════════════════════════════════════

const CACHE_NAME    = 'zen-journal-v1';
const SHELL_ASSETS  = [
  './',
  './index.html',          // adjust filename if yours differs
  './zen-journal.html',    // include both common names
  './icons/favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-144.png',
  './manifest.json',
];

// Supabase domains — always network-only
const SUPABASE_HOSTS = [
  'supabase.co',
  'supabase.io',
];

function isSupabase(url) {
  try {
    return SUPABASE_HOSTS.some(h => new URL(url).hostname.endsWith(h));
  } catch { return false; }
}

// ── INSTALL — pre-cache shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll fails if any asset 404s — use individual adds so missing
      // optional icons don't break the install
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Could not cache:', url, err.message)
          )
        )
      );
    })
  );
  // Don't self.skipWaiting() here — we let the app control update timing
  // via the SKIP_WAITING message (swApplyUpdate in the app JS).
});

// ── ACTIVATE — purge old caches ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — routing logic ─────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignore non-GET and chrome-extension etc.
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // Supabase → always network-only (auth tokens, live data)
  if (isSupabase(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell assets → cache-first, fallback to network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Revalidate in background
        const networkFetch = fetch(request).then(response => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
          }
          return response;
        }).catch(() => {/* offline — cached version already returned */});

        return cached;
      }
      // Not in cache — fetch and cache
      return fetch(request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        }
        return response;
      });
    })
  );
});

// ── MESSAGE — handle SKIP_WAITING from app ────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── BACKGROUND SYNC — flush queued entries ────────────
// Fires when connectivity returns after SB.enqueue() registered
// the 'zj-sync-entries' tag via registerBgSync().
self.addEventListener('sync', event => {
  if (event.tag === 'zj-sync-entries') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SW_SYNC_TRIGGER' });
  });
}

// ── PUSH (reserved for future notifications) ──────────
// self.addEventListener('push', event => { … });
