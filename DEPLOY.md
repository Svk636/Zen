# झेन जर्नल — GitHub Pages Deployment Checklist

## Repository structure required

```
your-repo/
├── .nojekyll          ← empty file, prevents Jekyll processing
├── .gitignore         ← excludes config.js (has real keys)
├── config.js.example  ← template, safe to commit
├── config.js          ← YOUR keys — gitignored, never commit
├── index.html
├── manifest.json
├── sw.js
└── icons/
    ├── favicon.ico
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-144.png
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

---

## One-time setup

```bash
# 1. Clone / init your repo
git clone https://github.com/YOU/zen-journal.git
cd zen-journal

# 2. Copy the example config and fill in your keys
cp config.js.example config.js
# Edit config.js — add Supabase URL/key and AI provider key

# 3. Set GitHub Pages source
#    Repo → Settings → Pages → Source: "Deploy from branch" → main / root
```

---

## Config key priority (per key, evaluated at runtime)

| Priority | Source | How to set |
|----------|--------|------------|
| 1st | `localStorage` | User saves via Settings panel in the app |
| 2nd | `config.js` → `window.APP_CONFIG` | You fill in `config.js` before deploy |
| 3rd | Hardcoded fallback in `index.html` | Supabase anon key only; always present |

AI provider keys have **no** hardcoded fallback — they fall back to `''` (AI features disabled until a key is provided via config.js or Settings).

---

## Updating the app (bump cache)

Every time you push a new `index.html`, bump the cache version in `sw.js`:

```js
// sw.js line 8
const CACHE_NAME = 'zj-v5';   // ← increment this on every deploy
```

Otherwise returning visitors may see a stale cached version.

---

## Supabase setup (one-time)

1. Create a project at https://supabase.com
2. SQL Editor → paste `schema.sql` → Run
3. Copy **Project URL** and **anon/public key** into `config.js`

The anon key is safe to ship in `config.js` — every table in `schema.sql`
uses Row Level Security locked to `auth.uid()`.

---

## GitHub Pages URL note

If your site is at `https://you.github.io/zen-journal/` (subdirectory), the
`manifest.json` and `sw.js` use `./` relative paths which work correctly.
No `<base href>` tag needed.
