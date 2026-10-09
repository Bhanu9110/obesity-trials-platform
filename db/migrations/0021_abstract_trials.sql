-- 0021_abstract_trials.sql
-- The clinical trial(s) a conference abstract reports on, e.g. ["NCT06921486"] or ["ACCESS", "ACCESS II"].
-- A drug with no ClinicalTrials.gov trial in the database yet counts the clinical trials its
-- abstracts report (distinct trial IDs / names; abstracts naming no trial count as one).

ALTER TABLE conference_abstracts ADD COLUMN IF NOT EXISTS trial_ids  text[] NOT NULL DEFAULT '{}';
ALTER TABLE conference_abstracts ADD COLUMN IF NOT EXISTS study_type text;
