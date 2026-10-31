-- 0027_pubmed.sql
-- PubMed papers (NCBI E-utilities), filled by the daily sync (sync/src/pubmed.ts):
--   * publications          one row per PubMed paper (title, journal, date, authors, DOI, abstract)
--   * trial_publications    papers that cite a trial's NCT ID (PubMed "secondary ID" or the abstract);
--                           is_results = the paper reports the trial's results (not a protocol / design paper)
--   * product_publications  the newest papers naming a drug or its code names (any topic); the total
--                           number found on PubMed is kept in products.pubmed_count
-- Only public bibliographic data is stored. Nothing here is edited by hand.

CREATE TABLE IF NOT EXISTS publications (
  pmid        text PRIMARY KEY,
  title       text NOT NULL,
  journal     text,
  pub_date    text,            -- as PubMed gives it: "2024 Mar 14", "2023 Dec", "2022"
  pub_year    int,
  authors     text,            -- "Wilding JPH, Batterham RL, Calanna S, et al."
  doi         text,
  pub_types   text[] NOT NULL DEFAULT '{}',
  abstract    text,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trial_publications (
  nct_id      text NOT NULL,
  pmid        text NOT NULL REFERENCES publications(pmid) ON DELETE CASCADE,
  is_results  boolean NOT NULL DEFAULT false,
  found_by    text NOT NULL DEFAULT 'secondary_id',   -- 'secondary_id' | 'abstract'
  PRIMARY KEY (nct_id, pmid)
);
CREATE INDEX IF NOT EXISTS trial_publications_pmid ON trial_publications (pmid);

CREATE TABLE IF NOT EXISTS product_publications (
  product_slug text NOT NULL,
  pmid         text NOT NULL REFERENCES publications(pmid) ON DELETE CASCADE,
  PRIMARY KEY (product_slug, pmid)
);
CREATE INDEX IF NOT EXISTS product_publications_pmid ON product_publications (pmid);

ALTER TABLE trials   ADD COLUMN IF NOT EXISTS pubmed_checked_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pubmed_checked_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pubmed_count      int;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pubmed_query      text;

COMMENT ON TABLE publications IS 'PubMed papers linked to trials or drugs (daily sync, NCBI E-utilities).';
COMMENT ON COLUMN products.pubmed_count IS 'Papers on PubMed naming the drug or its code names (all topics).';
COMMENT ON COLUMN products.pubmed_query IS 'The PubMed search used for the drug (shown as a "see all on PubMed" link).';

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_publications ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON publications, trial_publications, product_publications FROM anon, authenticated';
  END IF;
END $$;
