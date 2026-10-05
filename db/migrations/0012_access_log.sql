-- 0012_access_log.sql
-- Who uses the website: every sign-in, failed sign-in attempt, sign-out and page
-- view, with the visitor's approximate location (from Vercel's geo headers), IP
-- address and browser. Shown to admins on the Admin page. Rows older than 180
-- days are deleted by the website itself.

CREATE TABLE IF NOT EXISTS access_log (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  event       text        NOT NULL CHECK (event IN ('login', 'login_failed', 'logout', 'page', 'blocked')),
  username    text,                 -- signed-in user, or the name typed in a failed attempt
  path        text,                 -- page viewed (event = 'page')
  ip          text,
  country     text,                 -- ISO code, e.g. IN
  region      text,
  city        text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS idx_access_log_at       ON access_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user_at  ON access_log (username, at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_ip_fail  ON access_log (ip, at DESC) WHERE event = 'login_failed';

COMMENT ON TABLE access_log IS 'Website sign-ins, failed attempts, sign-outs and page views (admin Access panel).';

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON access_log FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE access_log_id_seq FROM anon, authenticated';
  END IF;
END $$;
