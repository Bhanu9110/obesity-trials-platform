-- 0017_product_autofill.sql
-- Automatic drug-profile values. The daily job (`npm run enrich-products` in sync/)
-- fills these from the trial data plus two public references:
--   ChEMBL (EMBL-EBI)  modality, mechanism of action, research codes, trade names, max phase
--   openFDA drugsfda   US brand names, route, first US approval date
-- The hand-entered columns (modality, phase, moa, ...) are NEVER changed: the website
-- shows an automatic value only while the hand-entered one is blank, marked "auto".
--   auto_info        {"<field>": {"value": "...", "source": "ChEMBL"}, ...}
--   auto_lookup      cached ChEMBL / openFDA results (refreshed every 30 days)
--   auto_checked_at  when the references were last looked up
--   auto_updated_at  when auto_info last changed

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS auto_info       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_lookup     jsonb,
  ADD COLUMN IF NOT EXISTS auto_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_updated_at timestamptz;

COMMENT ON COLUMN products.auto_info IS
  'Automatic drug-profile values {field: {value, source}}; shown only where the hand-entered field is blank.';
