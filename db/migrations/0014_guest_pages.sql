-- 0014_guest_pages.sql
-- Which parts of the site each guest login may open, chosen on the Admin page.
-- Guests can never open the Admin page, whatever is listed here.
--   trials, drugs, changes, quality, quality_export (= Data quality CSV download)
-- Existing guests keep what they had before: Trials, Drugs and Changes.

ALTER TABLE guest_access
  ADD COLUMN IF NOT EXISTS pages text[] NOT NULL DEFAULT ARRAY['trials', 'drugs', 'changes'];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_access_pages_check') THEN
    ALTER TABLE guest_access ADD CONSTRAINT guest_access_pages_check
      CHECK (cardinality(pages) > 0
             AND pages <@ ARRAY['trials', 'drugs', 'changes', 'quality', 'quality_export']);
  END IF;
END $$;

COMMENT ON COLUMN guest_access.pages IS 'Pages this guest may open (Admin is never possible for guests).';
