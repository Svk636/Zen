# झेन जर्नल (Zen Journal)

A Marathi mindful journaling PWA with:
- Voice input (Web Speech API) in Marathi and other languages
- DOJO OS templates (12 daily protocols)
- Timed intention sessions with microsteps
- Dark/light mode toggle
- Import/export (JSON, CSV, PDF)
- Supabase cloud sync with email/password auth
- Offline-capable via Service Worker

## Deployment

1. Fork/clone this repository
2. In `index.html`, update `SUPABASE_URL` and `SUPABASE_KEY` with your project credentials
3. Enable GitHub Pages from repository Settings → Pages → Deploy from branch (main / root)
4. The app will be available at `https://<username>.github.io/<repo>/`

## Supabase Setup

Create a table in your Supabase project:
```sql
create table zen_entries (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table zen_entries enable row level security;
create policy "Users can CRUD own entries"
  on zen_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```
