-- 0002_core_schema.sql
-- Lean schema. The database keeps ONLY what the drug database needs:
--   trials          one row per CT.gov study: phase, sponsor, indication,
--                   interventions and location (countries + continents).
--                   Full study details are NOT stored — the NCT ID links to
--                   clinicaltrials.gov for those.
--   products        one row per drug/product, derived from trial interventions.
--                   The product-info fields (modality, phase, MOA, ...) start
--                   BLANK and are filled in manually; the sync never touches them.
--   trial_products  which trials study which product.
--   product_aliases optional manual merges (e.g. a code name -> its INN).
--
-- An older, wider database is converted by 0005_slim_existing.sql.
-- trials ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trials (
  nct_id              text PRIMARY KEY,
  phase               text,                         -- e.g. PHASE2, "PHASE2, PHASE3"
  sponsor             text,                         -- lead sponsor name
  lead_sponsor_class  text,                         -- INDUSTRY | NIH | OTHER ... (sponsor filter)
  conditions          text[] NOT NULL DEFAULT '{}', -- indication(s)
  interventions       text[] NOT NULL DEFAULT '{}', -- drug intervention names as registered
  countries           text[] NOT NULL DEFAULT '{}', -- distinct site countries
  continents          text[] NOT NULL DEFAULT '{}', -- derived from countries
  -- sync bookkeeping
  is_active           bool NOT NULL DEFAULT true,
  source_checksum     text,                         -- MD5 of the API payload; unchanged => skip
  version             int  NOT NULL DEFAULT 1,
  fetched_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trials IS 'Lean CT.gov trial record: phase, sponsor, indication, interventions, location. Details live on clinicaltrials.gov.';

-- products -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id             serial PRIMARY KEY,
  slug           text UNIQUE NOT NULL,   -- normalized key, also used in the URL
  name           text NOT NULL,          -- display name
  -- Manually curated product info (all blank until edited on the drug page).
  modality       text,
  phase          text,                   -- highest development phase (manual)
  moa            text,                   -- mechanism of action
  roa            text,                   -- route of administration
  approved       text,                   -- 'Yes' | 'No' | NULL
  approval_date  date,
  sponsor        text,
  drug_class     text,
  info_updated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE products IS 'Drug/product master. Product-info columns are manual and never overwritten by the sync.';

-- trial <-> product ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS trial_products (
  nct_id      text REFERENCES trials(nct_id) ON DELETE CASCADE,
  product_id  int  REFERENCES products(id)   ON DELETE CASCADE,
  PRIMARY KEY (nct_id, product_id)
);

-- manual product merges --------------------------------------------------------
-- alias_slug: the normalized key of a name to fold in (e.g. 'ly3298176')
-- product_slug: the product it belongs to (e.g. 'tirzepatide')
-- After adding rows, run `npm run rebuild-products` in sync/ (or restart the scheduler).
CREATE TABLE IF NOT EXISTS product_aliases (
  alias_slug    text PRIMARY KEY,
  product_slug  text NOT NULL,
  product_name  text
);

-- small key/value store (e.g. which product-matching rules built trial_products)
CREATE TABLE IF NOT EXISTS app_meta (
  key    text PRIMARY KEY,
  value  text
);
