-- 0024_drug_development.sql
-- Development, regulatory and commercial profile of each drug:
--   products        + INN, API, regulatory status, designations, patents / exclusivity,
--                     anticipated launch, efficacy signal, safety signal (typed on the website)
--                   + curated_info: the same fields (and others) from the research files in
--                     sync/data/profiles/*.json, as {field: {value, source}}. Shown while the
--                     typed field is blank; it outranks the automatic values in auto_info.
--   product_results     efficacy and safety results, one row per trial / endpoint
--   product_milestones  dated events: regulatory steps, readouts, launches, patent expiries,
--                       inflection points, upcoming milestones
-- Rows from the research files have origin = 'curated' (replaced on every sync, but a row an
-- editor hid stays hidden); rows added on the website have origin = 'manual' and are never
-- touched by the sync.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS inn                text,
  ADD COLUMN IF NOT EXISTS api                text,
  ADD COLUMN IF NOT EXISTS regulatory_status  text,
  ADD COLUMN IF NOT EXISTS designations       text,
  ADD COLUMN IF NOT EXISTS patents            text,
  ADD COLUMN IF NOT EXISTS anticipated_launch text,
  ADD COLUMN IF NOT EXISTS efficacy_signal    text,
  ADD COLUMN IF NOT EXISTS safety_signal      text,
  ADD COLUMN IF NOT EXISTS curated_info       jsonb,
  ADD COLUMN IF NOT EXISTS curated_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS product_results (
  id            bigserial   PRIMARY KEY,
  product_slug  text        NOT NULL REFERENCES products(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('efficacy', 'safety')),
  trial         text,
  phase         text,
  population    text,
  duration      text,
  dose          text,
  endpoint      text,
  result        text        NOT NULL,
  comparator    text,
  reported      text,                    -- "2026-05", "2025" …
  source_label  text,
  source_url    text,
  origin        text        NOT NULL DEFAULT 'manual' CHECK (origin IN ('curated', 'manual')),
  curated_key   text,                    -- stable id of a research-file row (origin = 'curated')
  hidden        boolean     NOT NULL DEFAULT false,
  sort          int         NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_results_slug ON product_results (product_slug, kind, sort);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_results_curated ON product_results (product_slug, curated_key) WHERE curated_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_milestones (
  id            bigserial   PRIMARY KEY,
  product_slug  text        NOT NULL REFERENCES products(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('regulatory', 'readout', 'launch', 'patent', 'inflection', 'milestone')),
  title         text        NOT NULL,
  detail        text,
  date_label    text,                    -- as written: "2026-03-19", "2026-Q4", "2026-H2", "2027"; NULL = date not known
  date_sort     date,                    -- first day of that period, for sorting
  status        text        NOT NULL DEFAULT 'expected' CHECK (status IN ('done', 'expected', 'delayed', 'cancelled')),
  region        text,
  source_label  text,
  source_url    text,
  origin        text        NOT NULL DEFAULT 'manual' CHECK (origin IN ('curated', 'manual')),
  curated_key   text,
  hidden        boolean     NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_milestones_slug ON product_milestones (product_slug, date_sort);
CREATE INDEX IF NOT EXISTS idx_product_milestones_upcoming ON product_milestones (date_sort) WHERE status = 'expected' AND NOT hidden;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_milestones_curated ON product_milestones (product_slug, curated_key) WHERE curated_key IS NOT NULL;

COMMENT ON TABLE product_results IS 'Efficacy and safety results per drug (research files + website edits).';
COMMENT ON TABLE product_milestones IS 'Regulatory steps, readouts, launches, patent expiries, inflection points and upcoming milestones per drug.';

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE product_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_milestones ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON product_results, product_milestones FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE product_results_id_seq, product_milestones_id_seq FROM anon, authenticated';
  END IF;
END $$;
