-- 0018_intervention_other_names.sql  (also: pipeline_code_names, below)
-- "Other names" that ClinicalTrials.gov lists for each trial intervention, e.g.
-- Enicepatide -> CT-388, HRS9531 -> ribupatide. Refreshed by the daily drug-profile
-- auto-fill (`npm run enrich-products`); used only to fill a drug's Alias field and to
-- look the drug up in ChEMBL under its code names. Not part of the trial record, so it
-- never shows up as a registry change.

CREATE TABLE IF NOT EXISTS intervention_other_names (
  nct_id        text NOT NULL REFERENCES trials(nct_id) ON DELETE CASCADE,
  intervention  text NOT NULL,           -- intervention name as registered
  other_name    text NOT NULL,           -- one listed other name
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nct_id, intervention, other_name)
);

CREATE INDEX IF NOT EXISTS idx_intervention_other_names_nct ON intervention_other_names (nct_id);

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE intervention_other_names ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON intervention_other_names FROM anon, authenticated';
  END IF;
END $$;

-- Code names found on drug companies' public pipeline pages (sync/data/pipeline-sources.json),
-- e.g. Roche's "RG6640 · Enicepatide (CT-388)". Re-checked monthly by the auto-fill.
CREATE TABLE IF NOT EXISTS pipeline_code_names (
  product_slug  text NOT NULL,           -- the drug page it belongs to
  alias         text NOT NULL,           -- code / name as the company writes it
  company       text NOT NULL,
  source_url    text,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_slug, alias, company)
);

ALTER TABLE pipeline_code_names ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON pipeline_code_names FROM anon, authenticated';
  END IF;
END $$;
