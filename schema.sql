-- ═══════════════════════════════════════════════════════════════
--  झेन जर्नल — Supabase SQL Schema  (PostgreSQL 15+)
--
--  Run this in: Supabase Dashboard → SQL Editor → New query
--
--  Tables:
--    zen_entries      — journal entries (thoughts & intentions)
--    zen_sync_log     — immutable audit trail of all write operations
--
--  RPCs (Postgres functions):
--    soft_delete_entry(entry_id) — marks an entry deleted without removing it
--    purge_deleted_entries()     — hard-deletes entries deleted > 30 days ago
--
--  Row-Level Security (RLS):
--    Every table is RLS-enabled.
--    Users can only read/write their own rows (auth.uid() = user_id).
-- ═══════════════════════════════════════════════════════════════


-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "moddatetime"; -- auto-update updated_at


-- ════════════════════════════════════════════════════════════════
--  TABLE: zen_entries
--  Primary store for all journal entries.
--  `data` is a JSONB blob that mirrors the client-side entry object,
--  so the schema is forward-compatible with new client fields.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS zen_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data         JSONB       NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ           DEFAULT NULL   -- NULL = not deleted
);

-- ── Indexes ─────────────────────────────────────────────────────
-- Fast look-up of all live entries for a user, newest first
CREATE INDEX IF NOT EXISTS zen_entries_user_updated
  ON zen_entries (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- JSONB index for server-side text search on entry content
CREATE INDEX IF NOT EXISTS zen_entries_data_gin
  ON zen_entries USING GIN (data jsonb_path_ops);

-- ── Auto-update updated_at via trigger ──────────────────────────
CREATE OR REPLACE TRIGGER zen_entries_moddatetime
  BEFORE UPDATE ON zen_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE zen_entries ENABLE ROW LEVEL SECURITY;

-- Users can SELECT only their own non-deleted entries
CREATE POLICY "zen_entries_select_own"
  ON zen_entries FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

-- Users can INSERT only rows with their own user_id
CREATE POLICY "zen_entries_insert_own"
  ON zen_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can UPDATE only their own rows
CREATE POLICY "zen_entries_update_own"
  ON zen_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Hard DELETE is intentionally blocked via RLS (use soft_delete_entry() instead)
-- (No DELETE policy = no row-level deletes by client)


-- ════════════════════════════════════════════════════════════════
--  TABLE: zen_sync_log
--  Append-only audit trail. Never updated, never deleted by clients.
--  Useful for debugging sync issues and recovery.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS zen_sync_log (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id     UUID        NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('upsert', 'delete')),
  client_info  JSONB       DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying a user's recent activity
CREATE INDEX IF NOT EXISTS zen_sync_log_user_created
  ON zen_sync_log (user_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE zen_sync_log ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own log rows (useful for debugging)
CREATE POLICY "zen_sync_log_select_own"
  ON zen_sync_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can INSERT only their own log rows
CREATE POLICY "zen_sync_log_insert_own"
  ON zen_sync_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE policies (append-only)


-- ════════════════════════════════════════════════════════════════
--  FUNCTION: soft_delete_entry(entry_id UUID)
--  Called by the client via:
--    POST /rest/v1/rpc/soft_delete_entry  { "entry_id": "..." }
--  Sets deleted_at = NOW() so the entry is hidden from SELECT RLS,
--  but physical data is preserved for recovery / audit.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION soft_delete_entry(entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER   -- run as owner so RLS doesn't block the update
AS $$
BEGIN
  UPDATE zen_entries
  SET    deleted_at = NOW(),
         updated_at = NOW()
  WHERE  id      = entry_id
    AND  user_id = auth.uid()   -- still enforce ownership
    AND  deleted_at IS NULL;    -- idempotent
END;
$$;

-- Revoke direct execution; only authenticated users may call it
REVOKE ALL ON FUNCTION soft_delete_entry(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION soft_delete_entry(UUID) TO authenticated;


-- ════════════════════════════════════════════════════════════════
--  FUNCTION: purge_deleted_entries()
--  Hard-deletes entries soft-deleted more than 30 days ago.
--  Schedule via: Supabase Dashboard → Database → Extensions → pg_cron
--    SELECT cron.schedule('purge-zen-entries', '0 3 * * *',
--      'SELECT purge_deleted_entries()');
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION purge_deleted_entries()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  purged_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM zen_entries
    WHERE  deleted_at IS NOT NULL
      AND  deleted_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO purged_count FROM deleted;

  RETURN purged_count;
END;
$$;

-- Only service_role / postgres owner may call this (not authenticated users)
REVOKE ALL ON FUNCTION purge_deleted_entries() FROM PUBLIC;


-- ════════════════════════════════════════════════════════════════
--  VIEW: zen_entries_live  (convenience view, not required)
--  Returns only non-deleted entries. Respects RLS via the base table.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW zen_entries_live AS
  SELECT * FROM zen_entries WHERE deleted_at IS NULL;


-- ════════════════════════════════════════════════════════════════
--  REALTIME (optional)
--  Enable only if you want live multi-device sync without polling.
--  Go to: Supabase Dashboard → Database → Replication → zen_entries
-- ════════════════════════════════════════════════════════════════
-- ALTER PUBLICATION supabase_realtime ADD TABLE zen_entries;


-- ════════════════════════════════════════════════════════════════
--  STORAGE BUCKET (optional — for future attachment support)
-- ════════════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('zen-attachments', 'zen-attachments', false)
-- ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════════
--  SMOKE TEST
--  Run this query after setup to confirm everything is working:
-- ════════════════════════════════════════════════════════════════
-- SELECT
--   (SELECT COUNT(*) FROM zen_entries)   AS entries,
--   (SELECT COUNT(*) FROM zen_sync_log)  AS log_rows,
--   pg_size_pretty(pg_relation_size('zen_entries')) AS table_size;
