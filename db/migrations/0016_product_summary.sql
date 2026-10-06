-- 0016_product_summary.sql
-- A written summary per drug, entered by hand in the "Product summary" box on the
-- drug page (blank until someone writes one). The rest of that box is built from
-- the drug profile fields and from the drug's trials.

ALTER TABLE products ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz;

COMMENT ON COLUMN products.summary IS 'Hand-written product summary shown on the drug page.';
