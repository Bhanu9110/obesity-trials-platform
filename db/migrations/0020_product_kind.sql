-- 0020_product_kind.sql
-- Not every intervention name is a drug. "Caloric Restriction", "Blood Tests" or "Green Tea"
-- became drug pages because trials register them as interventions. They stay in the
-- database (the trials still name them) but are left out of the drug list, the dashboard
-- counts, search and the auto-fill:
--   kind        NULL = drug (shown) | 'supplement' (supplement / natural product) | 'not_drug'
--   kind_source 'list'   = sync/data/product-curation.json (reviewed list)
--               'rule'   = name rule for new entries (e.g. "... surgery", "placebo", "MRI")
--               'manual' = set on the drug page; never changed automatically afterwards
--   kind_note   why (shown on the drug page and the Quality page)

ALTER TABLE products ADD COLUMN IF NOT EXISTS kind        text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS kind_source text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS kind_note   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_kind_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('supplement', 'not_drug'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_kind ON products (kind) WHERE kind IS NOT NULL;
