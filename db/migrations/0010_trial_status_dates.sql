-- 0010_trial_status_dates.sql
-- Three more registry fields per trial, for the drug page's trial list:
--   overall_status  CT.gov recruitment status (RECRUITING, COMPLETED, ...)
--   start_date      study start as registered (YYYY-MM or YYYY-MM-DD)
--   enrollment      number of participants (actual or estimated)
-- They are filled by the next sync: the stored-field list changed, so that run
-- downloads every trial again once (see fetchScopeKey in sync/src/sync.ts).

ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS overall_status text,
  ADD COLUMN IF NOT EXISTS start_date     text,
  ADD COLUMN IF NOT EXISTS enrollment     int;

COMMENT ON COLUMN trials.overall_status IS 'CT.gov overall recruitment status.';
COMMENT ON COLUMN trials.start_date     IS 'Study start date as registered (YYYY-MM or YYYY-MM-DD).';
COMMENT ON COLUMN trials.enrollment     IS 'Participants (actual or estimated) as registered.';
