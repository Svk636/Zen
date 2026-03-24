/**
 * sw-registration.js — Zen Journal Service Worker Registration
 * ─────────────────────────────────────────────────────────────
 * Drop this file in your root and add ONE line before </body>:
 *
 *   <script src="sw-registration.js"></script>
 *
 * What this does:
 *   1. Registers sw.js on page load
 *   2. Listens for update events → shows the existing
 *      #sw-update-toast that is already in your HTML
 *   3. Exposes swApplyUpdate() — already called by your
 *      "अपडेट करा" button's onclick handler
 *   4. Handles shortcuts: ?action=new-thought / new-intention
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ── Guard ─────────────────────────────────────────────────────
  if (!('serviceWorker' in navigator)) return;

  // ── State ─────────────────────────────────────────────────────
  let _waitingWorker = null;

  // ── Register ──────────────────────────────────────────────────
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(function (reg) {
        console.log('[SW] Registered, scope:', reg.scope);

        // Already waiting from a previous load?
        if (reg.waiting) {
          _waitingWorker = reg.waiting;
          showUpdateToast();
        }

        // New SW installed while page is open
        reg.addEventListener('updatefound', function () {
          var newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // A new version is waiting — tell the user
              _waitingWorker = newWorker;
              showUpdateToast();
            }
          });
        });
      })
      .catch(function (err) {
        // Registration failure is non-fatal — app still works
        console.warn('[SW] Registration failed:', err);
      });

    // Listen for messages from the SW
    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || !data.type) return;

      switch (data.type) {
        case 'SW_ACTIVATED':
          console.log('[SW] Activated, version:', data.version);
          break;

        case 'RELOAD_PAGE':
          // SW has activated after SKIP_WAITING — reload all tabs
          window.location.reload();
          break;

        case 'SW_VERSION':
          console.log('[SW] Version info:', data);
          break;

        default:
          break;
      }
    });
  });

  // ── Show update toast ─────────────────────────────────────────
  // Your HTML already has #sw-update-toast — just show it.
  function showUpdateToast() {
    var toast = document.getElementById('sw-update-toast');
    if (toast) {
      toast.classList.add('visible');
    }
  }

  // ── Apply update (called by your "अपडेट करा" button) ─────────
  // The global function name matches the onclick in your HTML.
  window.swApplyUpdate = function () {
    var toast = document.getElementById('sw-update-toast');
    if (toast) toast.classList.remove('visible');

    if (_waitingWorker) {
      // Tell the waiting SW to take over
      _waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      _waitingWorker = null;
    } else {
      // Fallback: try to get the waiting worker from the registration
      navigator.serviceWorker.getRegistration('./').then(function (reg) {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          // Last resort: just reload
          window.location.reload();
        }
      });
    }
  };

  // ── Handle PWA shortcuts ──────────────────────────────────────
  // manifest.json defines shortcuts for "नवीन विचार" and "नवीन संकल्प".
  // When the user taps a shortcut, we open the relevant compose view.
  window.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    var action = params.get('action');
    if (!action) return;

    // Clean the URL so the query param doesn't persist on refresh
    history.replaceState(null, '', window.location.pathname);

    // Wait a tick for your app to fully initialise
    setTimeout(function () {
      if (action === 'new-thought') {
        // Trigger the "new thought" flow if your app exposes it
        if (typeof window.openNewThought === 'function') {
          window.openNewThought();
        }
      } else if (action === 'new-intention') {
        if (typeof window.openNewIntention === 'function') {
          window.openNewIntention();
        }
      }
    }, 300);
  });

  // ── Periodic update check ─────────────────────────────────────
  // Check for a new SW every 60 minutes while the app is open.
  setInterval(function () {
    navigator.serviceWorker.getRegistration('./').then(function (reg) {
      if (reg) reg.update().catch(function () {});
    });
  }, 60 * 60 * 1000);

})();
