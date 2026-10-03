-- 0009_phase2_reliability.sql
-- Phase 2: obesity classification (keep + label instead of delete), change
-- history, and a proper retry / dead-letter queue for failed records.

-- --------------------------------------------------------------------------- --
-- 1. Obesity classification
--    primary        obesity (or an in-scope indication) is the primary condition
--    comorbidity    obesity is mentioned, but as context of another disease
--    weight_related no obesity term, but weight-management terms (weight loss, BMI…)
--    unrelated      neither (returned by CT.gov's keyword search for other reasons)
--    The website shows `primary` trials by default; the rest are kept and labelled.
-- --------------------------------------------------------------------------- --
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS obesity_class      text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS obesity_reason     text,
  ADD COLUMN IF NOT EXISTS obesity_terms      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classifier_version text;

DO $$ BEGIN
  ALTER TABLE trials ADD CONSTRAINT trials_obesity_class_chk
    CHECK (obesity_class IN ('primary', 'comorbidity', 'weight_related', 'unrelated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_trials_obesity_class ON trials (obesity_class);

-- --------------------------------------------------------------------------- --
-- 2. Change history: one row per change to a stored trial.
--    added / removed: snapshot in new_value / old_value
--    updated:         one row per changed field (old -> new)
--    reclassified:    obesity_class changed (old -> new), with the reason
--    No foreign key on purpose: history of removed trials is kept.
-- --------------------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS trial_changes (
  id          bigserial PRIMARY KEY,
  trial_id    text NOT NULL,
  run_id      uuid,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  change      text NOT NULL CHECK (change IN ('added', 'updated', 'removed', 'reclassified')),
  field       text,
  old_value   jsonb,
  new_value   jsonb
);
CREATE INDEX IF NOT EXISTS idx_trial_changes_changed_at ON trial_changes (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_changes_trial ON trial_changes (trial_id, changed_at DESC);

-- --------------------------------------------------------------------------- --
-- 3. Retry queue + dead-letter queue (sync_failures)
--    pending    will be re-fetched and retried on a later run (with back-off)
--    dead       gave up after too many attempts — needs a person (Admin page)
--    resolved   a later attempt succeeded (or the record left the search scope)
--    dismissed  a person chose to ignore it
-- --------------------------------------------------------------------------- --
ALTER TABLE sync_failures
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS first_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolution      text,
  ADD COLUMN IF NOT EXISTS last_run_id     uuid;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sync_failures' AND column_name = 'resolved'
                AND is_generated = 'NEVER') THEN
    UPDATE sync_failures
       SET status = CASE WHEN resolved THEN 'resolved' ELSE 'pending' END
     WHERE status IS NULL;
    DROP INDEX IF EXISTS idx_sync_failures_unresolved;
    ALTER TABLE sync_failures DROP COLUMN resolved;
  END IF;
END $$;

UPDATE sync_failures SET status = 'pending' WHERE status IS NULL;
UPDATE sync_failures SET first_failed_at = coalesce(last_attempted, now()) WHERE first_failed_at IS NULL;
UPDATE sync_failures SET next_attempt_at = now() WHERE status = 'pending' AND next_attempt_at IS NULL;

-- Older versions logged one row per failed attempt: keep the newest open row per trial.
UPDATE sync_failures f SET status = 'resolved', resolved_at = now(), resolution = 'duplicate (merged)'
 WHERE f.status IN ('pending', 'dead')
   AND EXISTS (SELECT 1 FROM sync_failures g
                WHERE g.nct_id = f.nct_id AND g.status IN ('pending', 'dead')
                  AND (g.last_attempted, g.id::text) > (f.last_attempted, f.id::text));

ALTER TABLE sync_failures ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE sync_failures ALTER COLUMN status SET NOT NULL;
ALTER TABLE sync_failures ALTER COLUMN first_failed_at SET DEFAULT now();
DO $$ BEGIN
  ALTER TABLE sync_failures ADD CONSTRAINT sync_failures_status_chk
    CHECK (status IN ('pending', 'dead', 'resolved', 'dismissed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Read-only compatibility for code that still asks for "resolved".
ALTER TABLE sync_failures ADD COLUMN IF NOT EXISTS resolved boolean
  GENERATED ALWAYS AS (status IN ('resolved', 'dismissed')) STORED;

-- At most one open (pending or dead) entry per trial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_failures_open
  ON sync_failures (nct_id) WHERE status IN ('pending', 'dead');
CREATE INDEX IF NOT EXISTS idx_sync_failures_due
  ON sync_failures (next_attempt_at) WHERE status = 'pending';

-- New tables get the same lock-down as 0008 (Supabase public API sees nothing).
ALTER TABLE trial_changes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON trial_changes FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE trial_changes_id_seq FROM anon, authenticated';
  END IF;
END $$;
