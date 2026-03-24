# Zen Journal — PWA Package

## Files in this package

```
manifest.json              ← Web App Manifest (add <link rel="manifest"> in <head>)
sw.js                      ← Service Worker (place at root of your site)
schema_v2.sql              ← Supabase SQL schema (run in SQL Editor)
icons/
  favicon.ico              ← Multi-size ICO (16 + 32)
  apple-touch-icon.png     ← 180×180, iOS home screen
  icon-16.png              ← Browser tab
  icon-32.png              ← Browser tab (retina)
  icon-48.png
  icon-72.png              ← Android legacy
  icon-96.png
  icon-128.png
  icon-144.png             ← Windows tile / Android
  icon-152.png             ← iPad home screen
  icon-180.png
  icon-192.png             ← Android home screen (standard)
  icon-256.png
  icon-384.png
  icon-512.png             ← Android splash / store listing
  icon-maskable-192.png    ← Android adaptive icon (192)
  icon-maskable-512.png    ← Android adaptive icon (512)
sw-registration.js         ← Drop-in SW registration script
generate-icons.js          ← Script to regenerate icons from source SVG
```

---

## 1  Deploy checklist

- [ ] Copy **all files** to the **root** of your web server / hosting bucket
- [ ] `sw.js` **must** live at the root (same origin as `index.html`)
- [ ] `manifest.json` **must** live at the root
- [ ] HTTPS is required for SW + installability (localhost is exempt)

---

## 2  Add to your `index.html`

Inside `<head>` — these tags are already present in your file, confirm they match:

```html
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/x-icon"         href="icons/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32"  href="icons/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16"  href="icons/icon-16.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="icons/icon-512.png">
<meta name="msapplication-TileImage" content="icons/icon-144.png">
<meta name="msapplication-TileColor" content="#f7f5f0">
```

Just before `</body>`, add the registration script:

```html
<script src="sw-registration.js"></script>
```

---

## 3  SW update flow (already wired in sw-registration.js)

1. New deploy → `APP_VERSION` in `sw.js` is bumped
2. Browser detects updated SW → installs in background
3. `sw-registration.js` receives `SW_UPDATE_AVAILABLE` message
4. Your existing `#sw-update-toast` is shown automatically
5. User taps **"अपडेट करा"** → `swApplyUpdate()` sends `SKIP_WAITING`
6. SW activates → all tabs reload

---

## 4  Supabase schema (schema_v2.sql)

**New in v2 vs the original schema:**

| Addition | Purpose |
|---|---|
| `deleted_at` column | Soft-delete support — entries hidden, not lost |
| `zen_sync_log` table | Append-only audit log for sync debugging |
| `app_settings` table | Per-user preferences (theme, lang, etc.) |
| `v_stats` view | Daily practice summary (streaks screen) |
| `soft_delete_entry()` | RLS-safe helper; call from app |
| `purge_deleted_entries()` | Admin/cron hard-purge of old soft-deletes |
| Partial indexes | All existing indexes now exclude soft-deleted rows |
| Semicolon injection guard | `exec_sql` rejects stacked statements |

Run the full file once in **Supabase → SQL Editor → New Query → Run**.

---

## 5  Regenerating icons

```bash
node generate-icons.js   # requires Node.js
# or
python3 -c "..."         # uses cairosvg (pip install cairosvg)
```

To change the icon design, edit the SVG template inside `generate-icons.js`
and re-run.
