-- 0005_slim_existing.sql
-- Converts an OLDER, wide database (trials + interventions/locations/eligibility/
-- outcomes/arms/NLP/raw-payload cache/audit log) into the lean schema, keeping the
-- data that matters: phase, sponsor, indication, interventions, countries/continents.
--
-- Safe on a fresh database (every step is guarded) and safe to re-run.
-- Products are (re)built from trials.interventions by the sync service
-- (`npm run rebuild-products`, which the scheduler also runs automatically).
-- 1. Make sure the lean columns exist on an old trials table.
ALTER TABLE trials ADD COLUMN IF NOT EXISTS conditions    text[];
ALTER TABLE trials ADD COLUMN IF NOT EXISTS interventions text[];
ALTER TABLE trials ADD COLUMN IF NOT EXISTS countries     text[];
ALTER TABLE trials ADD COLUMN IF NOT EXISTS continents    text[];
ALTER TABLE trials ADD COLUMN IF NOT EXISTS lead_sponsor_class text;

-- 2. Old multi-registry builds: keep CT.gov only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'trials' AND column_name = 'source') THEN
    EXECUTE 'DELETE FROM trials WHERE source IS DISTINCT FROM ''CTGOV''';
  END IF;
END $$;

-- 3. Soft-deleted rows (non-primary-obesity trials) are no longer kept at all.
DELETE FROM trials WHERE is_active = false;

-- 4. Backfill interventions + countries from the old child tables, if present.
DO $$
BEGIN
  IF to_regclass('public.interventions') IS NOT NULL THEN
    UPDATE trials t
       SET interventions = sub.names
      FROM (SELECT nct_id,
                   array_agg(DISTINCT btrim(intervention_name) ORDER BY btrim(intervention_name)) AS names
              FROM interventions
             WHERE intervention_type IN ('DRUG', 'BIOLOGICAL', 'COMBINATION_PRODUCT')
               AND coalesce(btrim(intervention_name), '') <> ''
             GROUP BY nct_id) sub
     WHERE sub.nct_id = t.nct_id
       AND coalesce(t.interventions, '{}') = '{}';
  END IF;

  IF to_regclass('public.locations') IS NOT NULL THEN
    UPDATE trials t
       SET countries = sub.cs
      FROM (SELECT nct_id,
                   array_agg(DISTINCT btrim(country) ORDER BY btrim(country)) AS cs
              FROM locations
             WHERE coalesce(btrim(country), '') <> ''
             GROUP BY nct_id) sub
     WHERE sub.nct_id = t.nct_id
       AND coalesce(t.countries, '{}') = '{}';
  END IF;
END $$;

-- 5. NOT NULL + defaults on the array columns.
UPDATE trials SET conditions    = '{}' WHERE conditions    IS NULL;
UPDATE trials SET interventions = '{}' WHERE interventions IS NULL;
UPDATE trials SET countries     = '{}' WHERE countries     IS NULL;
ALTER TABLE trials ALTER COLUMN conditions    SET DEFAULT '{}', ALTER COLUMN conditions    SET NOT NULL;
ALTER TABLE trials ALTER COLUMN interventions SET DEFAULT '{}', ALTER COLUMN interventions SET NOT NULL;
ALTER TABLE trials ALTER COLUMN countries     SET DEFAULT '{}', ALTER COLUMN countries     SET NOT NULL;

-- 6. Continents are always recomputed, so edits to ref_country_continent apply
--    on the next migrate run.
UPDATE trials SET continents = continents_of(countries)
 WHERE continents IS DISTINCT FROM continents_of(countries);
ALTER TABLE trials ALTER COLUMN continents SET DEFAULT '{}', ALTER COLUMN continents SET NOT NULL;

-- 7. Drop the bulky legacy objects.
DROP TRIGGER  IF EXISTS trg_trials_audit ON trials;
DROP FUNCTION IF EXISTS fn_trials_audit();
DROP TABLE IF EXISTS
  drug_details, interventions, trial_arms, outcomes, eligibility, locations,
  trial_nlp, api_cache, trial_audit_log, trial_quality_scores,
  ref_intervention_categories, ref_trial_status
  CASCADE;

ALTER TABLE trials
  DROP COLUMN IF EXISTS brief_title,
  DROP COLUMN IF EXISTS official_title,
  DROP COLUMN IF EXISTS overall_status,
  DROP COLUMN IF EXISTS study_type,
  DROP COLUMN IF EXISTS enrollment,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS completion_date,
  DROP COLUMN IF EXISTS last_updated,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS registry_url;

UPDATE trials SET version = 1 WHERE version IS NULL;
UPDATE trials SET fetched_at = now() WHERE fetched_at IS NULL;

DROP EXTENSION IF EXISTS vector;
