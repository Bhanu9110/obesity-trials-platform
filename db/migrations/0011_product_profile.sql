-- 0011_product_profile.sql
-- More manually curated drug-profile fields for the Drugs list. Like the other
-- product-info columns they start blank, are edited on the drug page and are never
-- touched by the sync. While blank, the website shows an automatic suggestion
-- (from the trial data and a built-in reference list) in grey.
--   aliases           development / code names, e.g. "LY3298176"
--   brand_names       brand (trade) names, e.g. "Mounjaro, Zepbound"
--   candidate         'Pipeline' (in development) | 'Non-pipeline' (marketed, generic, withdrawn, discontinued)
--   parent_drug       similar or parent drug(s), e.g. the components of a combination
--   therapy_subclass  subclass under the existing drug_class column (therapy class)
--   indication        target indication(s)
-- The existing "sponsor" column is shown as the drug's Company.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS aliases          text,
  ADD COLUMN IF NOT EXISTS brand_names      text,
  ADD COLUMN IF NOT EXISTS candidate        text,
  ADD COLUMN IF NOT EXISTS parent_drug      text,
  ADD COLUMN IF NOT EXISTS therapy_subclass text,
  ADD COLUMN IF NOT EXISTS indication       text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_candidate_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_candidate_check
      CHECK (candidate IS NULL OR candidate IN ('Pipeline', 'Non-pipeline'));
  END IF;
END $$;
