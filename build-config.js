const fs = require('fs');

const config = `window.APP_CONFIG = {
  supabase: {
    url:     '${process.env.SUPABASE_URL}',
    anonKey: '${process.env.SUPABASE_ANON_KEY}',
  }
};
`;

fs.writeFileSync('config.js', config);
console.log('config.js generated ✓');
```

**Step 4 — Add `config.js` to `.gitignore`:**
```
config.js
