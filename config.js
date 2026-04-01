/**
 * config.js.example — झेन जर्नल local development template
 *
 * ── FOR LOCAL DEVELOPMENT ────────────────────────────────────────
 *   1. Copy this file:  cp config.js.example config.js
 *   2. Fill in your real keys below
 *   3. Open index.html in browser (or: npx serve .)
 *
 * ── FOR NETLIFY DEPLOYMENT ───────────────────────────────────────
 *   config.js is auto-generated from Netlify Environment Variables
 *   by the build command in netlify.toml — you do NOT need this file
 *   on the server. See README-DEPLOY.md for full setup instructions.
 *
 * ── SECURITY RULES ───────────────────────────────────────────────
 *   • config.js is in .gitignore — NEVER commit it to git
 *   • This example file (config.js.example) is safe to commit
 *   • The Supabase ANON key is safe in the browser (RLS enforced)
 *   • NEVER put the Supabase SERVICE_ROLE key here — server-side only
 *   • Rotate any key that has been accidentally exposed
 */

window.APP_CONFIG = {

  // ── AI Provider ─────────────────────────────────────────────────
  // Which provider to use. Supported: 'groq' | 'gemini' | 'openai' | 'claude'
  // Only one is active at a time. Keys for other providers are ignored.
  provider: 'groq',

  // ── Groq (free tier — recommended) ──────────────────────────────
  // Get key: https://console.groq.com/
  groq: {
    key:   'Groq Api Key here',      // e.g. gsk_xxxx...
    model: 'qwen/qwen3-32b',              // recommended free model
  },

  // ── Google Gemini (free tier) ────────────────────────────────────
  // Get key: https://aistudio.google.com/app/apikey
  gemini: {
    key:   'YOUR_GEMINI_API_KEY_HERE',    // e.g. AIzaS...
    model: 'gemini-1.5-flash',
  },

  // ── OpenAI ───────────────────────────────────────────────────────
  // Get key: https://platform.openai.com/api-keys
  openai: {
    key:   'YOUR_OPENAI_API_KEY_HERE',    // e.g. sk-proj-...
    model: 'gpt-4o-mini',
  },

  // ── Anthropic Claude ─────────────────────────────────────────────
  // Get key: https://console.anthropic.com/
  claude: {
    key:   'YOUR_CLAUDE_API_KEY_HERE',    // e.g. sk-ant-...
    model: 'claude-haiku-4-5-20251001',
  },

  // ── Supabase (optional — cloud sync across devices) ──────────────
  // Get from: Supabase Dashboard → Project Settings → API
  // Leave as-is if you don't want cloud sync (app works offline without it)
  supabase: {
    url:     'https://asduwjszfcauirrhfyaz.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZHV3anN6ZmNhdWlycmhmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTkxNDIsImV4cCI6MjA4OTkzNTE0Mn0.sae-lriYG2O0ItyTg85Eb_-auYd3fD4fYYiCU_ooOUM',
    // ⚠️  Do NOT put the service_role key here — it bypasses RLS
  },

};
