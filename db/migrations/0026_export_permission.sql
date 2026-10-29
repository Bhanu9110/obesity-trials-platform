-- 0026_export_permission.sql
-- Downloading data (Excel, PDF, CSV, Word) from the Trials and Drugs pages.
--   * The super admin, owners and admins can always export.
--   * Members and guests can export only when an admin ticks "Can download data" for their login.
--   * Every export is written to the audit log (event 'export', detail: what and how many rows).

ALTER TABLE site_users ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN site_users.can_export IS 'Members and guests: may download data (admins always may).';

ALTER TABLE access_log DROP CONSTRAINT IF EXISTS access_log_event_check;
ALTER TABLE access_log ADD CONSTRAINT access_log_event_check CHECK (event IN (
  'login', 'login_failed', 'logout', 'page', 'blocked',
  'user_added', 'user_changed', 'user_removed', 'password_changed', 'export'
));
