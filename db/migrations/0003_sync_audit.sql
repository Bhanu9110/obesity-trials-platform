-- 0003_sync_audit.sql
-- Sync job tracking and retry queue (shown on the Admin dashboard).
BEGIN;

CREATE TABLE IF NOT EXISTS sync_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at               timestamptz DEFAULT now(),
  status               text,               -- running | success | partial | failed
  trials_fetched       int,
  trials_upserted      int,
  trials_failed        int,
  error_detail         jsonb,
  api_pages_consumed   int,
  duration_ms          int
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_run_at ON sync_runs (run_at DESC);

CREATE TABLE IF NOT EXISTS sync_failures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nct_id            text,
  failure_type      text,
  error_msg         text,
  retry_count       int  DEFAULT 0,
  last_attempted    timestamptz,
  resolved          bool DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sync_failures_unresolved
  ON sync_failures (resolved) WHERE resolved = false;

COMMIT;
