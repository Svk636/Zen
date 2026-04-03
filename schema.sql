-- ═══════════════════════════════════════════════════════════════════════
--  ZenJournal — Supabase SQL Schema  (schema.sql)
--
--  HOW TO USE
--  1. Go to https://supabase.com → open your project
--  2. Click "SQL Editor" in the left sidebar
--  3. Paste this entire file and click "Run"
--  4. Copy your Project URL + anon key into index.html or config.js
--
--  TABLES CREATED
--    zen_entries      — core journal entries (JSONB payload, soft-delete)
--    zen_sync_log     — append-only audit trail of every sync action
--    app_settings     — per-user preference blob
--
--  RPC FUNCTIONS
--    soft_delete_entry(entry_id uuid) — sets deleted_at without exposing
--                                       raw UPDATE to the client
--
--  RLS POLICIES
--    Every table is locked to auth.uid() = user_id.
--    Anonymous read/write is NOT allowed.
-- ═══════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
--  0. Extensions (safe to re-run)
-- ────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- future full-text search


-- ────────────────────────────────────────────────────────────────────
--  1. zen_entries
--     One row per journal entry.
--     The entire client-side entry object is stored verbatim in `data`
--     (type, text, createdAt, updatedAt, microsteps, deadline, …).
--     `deleted_at` enables soft-delete so pull() never resurrects
--     deleted entries.
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.zen_entries (
  -- Primary key is the client-generated UUID inside the entry object,
  -- forwarded verbatim so upsert (merge-duplicates) works correctly.
  id          text        primary key,

  -- Owner — must match auth.uid(); enforced by RLS below.
  user_id     uuid        not null references auth.users(id) on delete cascade,

  -- Full entry payload from the client (type, text, tags, microsteps, …)
  data        jsonb       not null default '{}'::jsonb,

  -- Timestamps managed server-side for conflict resolution.
  -- The client also embeds its own updatedAt inside `data`; the server
  -- column is what pull() orders by.
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Soft-delete: non-null means deleted; pull() filters deleted_at=is.null
  deleted_at  timestamptz          default null
);

-- Index for the main pull() query pattern
create index if not exists zen_entries_user_updated
  on public.zen_entries (user_id, updated_at desc)
  where deleted_at is null;

-- Index for full-text search on entry text (optional, future use)
create index if not exists zen_entries_data_gin
  on public.zen_entries using gin (data);

-- Auto-update updated_at on every row change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists zen_entries_touch on public.zen_entries;
create trigger zen_entries_touch
  before update on public.zen_entries
  for each row execute function public.touch_updated_at();

-- Enable Row Level Security
alter table public.zen_entries enable row level security;

-- SELECT: user can only read their own entries
create policy "zen_entries: owner select"
  on public.zen_entries for select
  using (auth.uid() = user_id);

-- INSERT: user can only insert rows where user_id = their uid
create policy "zen_entries: owner insert"
  on public.zen_entries for insert
  with check (auth.uid() = user_id);

-- UPDATE: user can only update their own rows
create policy "zen_entries: owner update"
  on public.zen_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: not exposed directly; soft-delete via RPC only
-- (no DELETE policy = PostgREST DELETE is blocked by RLS)


-- ────────────────────────────────────────────────────────────────────
--  2. soft_delete_entry  RPC
--     Called by the client as POST /rest/v1/rpc/soft_delete_entry
--     with body { "entry_id": "<text>" }
--     Security: SECURITY DEFINER runs as the function owner but the
--     inner WHERE clause checks auth.uid() so users can only delete
--     their own rows.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.soft_delete_entry(entry_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.zen_entries
  set    deleted_at = now(),
         updated_at = now()
  where  id        = entry_id
    and  user_id   = auth.uid()   -- RLS-equivalent guard
    and  deleted_at is null;      -- idempotent: no-op if already deleted
end;
$$;

-- Revoke direct execution from anon; only authenticated users may call it
revoke execute on function public.soft_delete_entry(text) from anon;
grant  execute on function public.soft_delete_entry(text) to authenticated;


-- ────────────────────────────────────────────────────────────────────
--  3. zen_sync_log
--     Append-only audit trail.  One row per sync action (upsert /
--     delete).  Never updated after insert.
--     client_info stores the truncated user-agent for diagnostics.
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.zen_sync_log (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  entry_id    text        not null,
  action      text        not null check (action in ('upsert', 'delete')),
  client_info jsonb                default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Index for per-user audit queries
create index if not exists zen_sync_log_user
  on public.zen_sync_log (user_id, created_at desc);

alter table public.zen_sync_log enable row level security;

-- SELECT: user can read their own log rows
create policy "zen_sync_log: owner select"
  on public.zen_sync_log for select
  using (auth.uid() = user_id);

-- INSERT: user can append their own log rows
create policy "zen_sync_log: owner insert"
  on public.zen_sync_log for insert
  with check (auth.uid() = user_id);

-- No UPDATE or DELETE on the log — it is append-only


-- ────────────────────────────────────────────────────────────────────
--  4. app_settings
--     One row per user.  Stores the entire settings blob as JSONB
--     (theme, AI provider, timer durations, habit config, …).
--     Upserted via Prefer: resolution=merge-duplicates.
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  -- Primary key is the user's auth UUID so there is exactly one row
  -- per user and upsert (merge-duplicates on PK) is safe.
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;

create policy "app_settings: owner select"
  on public.app_settings for select
  using (auth.uid() = user_id);

create policy "app_settings: owner insert"
  on public.app_settings for insert
  with check (auth.uid() = user_id);

create policy "app_settings: owner update"
  on public.app_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────────────
--  5. Grant table access to the authenticated role
--     (anon role gets nothing — all access requires a valid JWT)
-- ────────────────────────────────────────────────────────────────────
grant select, insert, update
  on public.zen_entries
  to authenticated;

grant select, insert
  on public.zen_sync_log
  to authenticated;

grant usage, select
  on sequence public.zen_sync_log_id_seq
  to authenticated;

grant select, insert, update
  on public.app_settings
  to authenticated;


-- ────────────────────────────────────────────────────────────────────
--  6. Realtime publication (optional — enables live multi-device sync)
--     Comment out if you don't need real-time push.
-- ────────────────────────────────────────────────────────────────────
-- alter publication supabase_realtime add table public.zen_entries;


-- ════════════════════════════════════════════════════════════════════
--  DONE — verify with:
--    select tablename from pg_tables where schemaname = 'public';
--  Expected: zen_entries, zen_sync_log, app_settings
-- ════════════════════════════════════════════════════════════════════
