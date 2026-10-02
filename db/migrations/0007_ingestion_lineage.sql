-- 0007_ingestion_lineage.sql
-- Ingestion lineage and data quality (Priority 1).
--
--   raw_trials     the source record exactly as ingested (only the fields we
--                  fetch), with a content hash and the parser version that last
--                  mapped it. Lets us re-parse without re-downloading and detect
--                  real changes.
--   trial_sources  which registry record(s) each trial comes from — one row per
--                  (source, source_id). CT.gov today; CTIS / ChiCTR later map
--                  onto the same canonical trial.
--   trials         + source_updated_at, first_seen_at, last_seen_at (renamed from
--                  fetched_at), last_changed_at, parser_version, record_hash
--                  (renamed from source_checksum), last_run_id.
--   trial_quality  per-trial data-quality score and list of issues.
--   sync_runs      + mode, parser_version, unchanged / filtered counts.
--
-- Applied once by the tracked runner (no IF NOT EXISTS guards needed).

-- raw_trials ----------------------------------------------------------------
CREATE TABLE raw_trials (
  source             text        NOT NULL,              -- 'CTGOV'
  source_id          text        NOT NULL,              -- registry id, e.g. NCT01234567
  payload            jsonb       NOT NULL,              -- source record as ingested
  content_hash       text        NOT NULL,              -- sha256 of the canonical JSON payload
  parser_version     text        NOT NULL,              -- parser that last mapped this payload
  source_updated_at  date,                              -- registry's own "last updated" date
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(), -- last time a sync saw it (changed or not)
  last_changed_at    timestamptz NOT NULL DEFAULT now(), -- last time content_hash changed
  last_run_id        uuid,                              -- sync_runs.id that last changed it
  PRIMARY KEY (source, source_id)
);
CREATE INDEX idx_raw_trials_parser ON raw_trials (parser_version);
COMMENT ON TABLE raw_trials IS 'Source records as ingested (fetched fields only), hashed and versioned by parser.';

-- trial_sources -------------------------------------------------------------
CREATE TABLE trial_sources (
  source             text        NOT NULL,
  source_id          text        NOT NULL,
  trial_id           text        NOT NULL REFERENCES trials(nct_id) ON DELETE CASCADE,
  source_url         text,
  is_primary         bool        NOT NULL DEFAULT true,  -- the record the trial's fields come from
  source_updated_at  date,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX idx_trial_sources_trial ON trial_sources (trial_id);
COMMENT ON TABLE trial_sources IS 'Registry records behind each canonical trial (multi-registry ready).';

-- trials: lineage columns ----------------------------------------------------
ALTER TABLE trials RENAME COLUMN fetched_at      TO last_seen_at;
ALTER TABLE trials RENAME COLUMN source_checksum TO record_hash;
ALTER TABLE trials
  ADD COLUMN source_updated_at date,
  ADD COLUMN first_seen_at     timestamptz,
  ADD COLUMN last_changed_at   timestamptz,
  ADD COLUMN parser_version    text,
  ADD COLUMN last_run_id       uuid;
UPDATE trials SET first_seen_at = last_seen_at, last_changed_at = last_seen_at;
ALTER TABLE trials
  ALTER COLUMN first_seen_at   SET DEFAULT now(), ALTER COLUMN first_seen_at   SET NOT NULL,
  ALTER COLUMN last_changed_at SET DEFAULT now(), ALTER COLUMN last_changed_at SET NOT NULL;
COMMENT ON COLUMN trials.record_hash IS 'sha256 of the mapped (lean) record; version bumps only when it changes.';
CREATE INDEX idx_trials_source_updated ON trials (source_updated_at DESC);

-- data quality --------------------------------------------------------------
CREATE TABLE trial_quality (
  trial_id        text PRIMARY KEY REFERENCES trials(nct_id) ON DELETE CASCADE,
  score           numeric(4,3) NOT NULL,          -- 1.000 = no issues
  error_count     int  NOT NULL DEFAULT 0,
  warning_count   int  NOT NULL DEFAULT 0,
  info_count      int  NOT NULL DEFAULT 0,
  issues          jsonb NOT NULL DEFAULT '[]',     -- [{code, severity, message, detail?}]
  parser_version  text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trial_quality_score  ON trial_quality (score);
CREATE INDEX idx_trial_quality_issues ON trial_quality USING GIN (issues jsonb_path_ops);
COMMENT ON TABLE trial_quality IS 'Per-trial data-quality checks, recomputed whenever the trial is (re)parsed.';

-- How many trials have each issue (for the admin / data-quality dashboard).
CREATE VIEW data_quality_summary AS
SELECT i->>'code'     AS code,
       i->>'severity' AS severity,
       count(*)::int  AS trials
  FROM trial_quality q
  CROSS JOIN LATERAL jsonb_array_elements(q.issues) AS i
 GROUP BY 1, 2;

-- sync_runs: richer run log --------------------------------------------------
ALTER TABLE sync_runs
  ADD COLUMN mode             text,   -- full | incremental | reparse | test
  ADD COLUMN parser_version   text,
  ADD COLUMN trials_unchanged int,
  ADD COLUMN trials_filtered  int;
