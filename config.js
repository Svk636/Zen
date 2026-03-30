// ── App Config ────────────────────────────────────────────────
// This file holds API keys for deployment.
// Add this file to .gitignore for local dev; push it separately for production.
//
// Keys defined here act as DEFAULTS — if a user has saved their own key
// in the settings panel (localStorage), that takes priority.

window.APP_CONFIG = {
  groq: {
    key:   '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',
    model: 'qwen/qwen3-32b',       // optional — overrides default model
  },
  // gemini: { key: 'YOUR_GEMINI_KEY_HERE' },
  // openai: { key: 'YOUR_OPENAI_KEY_HERE' },
  // claude: { key: 'YOUR_CLAUDE_KEY_HERE' },

  // Set a default provider for all users on load (optional).
  // If not set, the app defaults to 'groq'.
  // provider: 'groq',
};
