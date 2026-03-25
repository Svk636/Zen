// ═══════════════════════════════════════════════════════
//  ZEN JOURNAL — SERVICE WORKER  v1.0.0
//  Strategy: Cache-first for shell/assets, Network-first
//  for Supabase API calls, Background Sync for queued entries
// ═══════════════════════════════════════════════════════

const CACHE_NAME    = 'zen-journal-v1';
const SHELL_CACHE   = 'zen-journal-shell-v1';

// App shell — everything needed to run offline
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // Icons (served from ./icons/ folder)
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── INSTALL ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // activate new SW immediately
      .catch(err => {
        // If icon files don't exist yet, cache what we can
        console.warn('[SW] Shell cache partial failure (icons may be missing):', err.message);
        return caches.open(SHELL_CACHE).then(cache =>
          cache.addAll(['./', './index.html', './manifest.json'])
            .catch(() => {})
        );
      })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept: Chrome extensions, non-http(s), DevTools
  if (!request.url.startsWith('http')) return;

  // ── Supabase API calls → Network-first, no cache ──
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // ── CDN resources (jsPDF etc.) → Network-first, cache fallback ──
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(request)
          .then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cache.match(request))
      )
    );
    return;
  }

  // ── App shell & same-origin assets → Cache-first ──
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        // Not in cache — fetch and store
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
          }
          return response;
        }).catch(() => {
          // Offline fallback: serve index.html for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // ── Everything else: passthrough ──
  // (No event.respondWith → browser handles normally)
});

// ── BACKGROUND SYNC ──────────────────────────────────────
// Fires when browser regains connectivity, if sync was registered
self.addEventListener('sync', event => {
  if (event.tag === 'zj-sync-entries') {
    event.waitUntil(
      // Notify all open clients to flush their queue
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        .then(clients => {
          clients.forEach(client =>
            client.postMessage({ type: 'SW_SYNC_TRIGGER' })
          );
        })
    );
  }
});

// ── PUSH NOTIFICATIONS (optional — no-op if not configured) ──
self.addEventListener('push', event => {
  // Not used in current version — silently ignore
});

// ── MESSAGE — handle SKIP_WAITING from app ───────────────
// The app sends { type: 'SKIP_WAITING' } when the user clicks "Update"
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
