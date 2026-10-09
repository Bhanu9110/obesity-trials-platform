-- 0019_conference_abstracts.sql
-- Drug programs presented at scientific meetings (first: ADA 2026), from the data files in
-- sync/data/conference/*.json. Imported by the daily drug-profile auto-fill
-- (`npm run enrich-products`, or `npm run import-abstracts`). A drug that has abstracts
-- but no trial on ClinicalTrials.gov yet (most preclinical programs) still gets a drug
-- page; its profile is filled from the abstracts.

CREATE TABLE IF NOT EXISTS conference_abstracts (
  source         text NOT NULL,          -- 'ADA 2026'
  abstract_no    text NOT NULL,          -- '1032-OR'
  title          text,
  link           text,                   -- DOI link
  program        text,                   -- drug or program as the abstract names it
  sponsor        text,
  sponsor_basis  text,                   -- how the sponsor was worked out
  indication     text,
  stage          text,                   -- 'Clinical – Phase 2b' | 'Preclinical – in vivo' | ...
  mechanism      text,
  model          text,                   -- population / species / cells
  key_finding    text,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, abstract_no)
);

-- Which drug pages an abstract belongs to (one abstract can name several drugs).
CREATE TABLE IF NOT EXISTS product_abstracts (
  product_slug   text NOT NULL,
  source         text NOT NULL,
  abstract_no    text NOT NULL,
  drug_name      text NOT NULL,          -- the drug as the data file names it
  aliases        text[] NOT NULL DEFAULT '{}', -- code names given with it
  PRIMARY KEY (product_slug, source, abstract_no),
  FOREIGN KEY (source, abstract_no) REFERENCES conference_abstracts (source, abstract_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_abstracts_slug ON product_abstracts (product_slug);

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE conference_abstracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_abstracts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON conference_abstracts FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON product_abstracts FROM anon, authenticated';
  END IF;
END $$;
