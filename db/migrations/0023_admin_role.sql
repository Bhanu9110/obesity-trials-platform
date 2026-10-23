-- 0023_admin_role.sql
-- Super admin and admins.
--   * The super admin is the owner account named in the SUPER_ADMIN variable (Vercel); it is not
--     stored here. Only the super admin can create, change or remove admins.
--   * Admins are logins made on the website (role 'admin'): they open the Admin and Audit logs
--     pages and manage members and guests, like members they can have an end date or none.
--   * The audit log (access_log) also records what admins do to logins and password changes.

ALTER TABLE site_users DROP CONSTRAINT IF EXISTS site_users_role_check;
ALTER TABLE site_users ADD CONSTRAINT site_users_role_check CHECK (role IN ('admin', 'member', 'guest'));
-- Guests must always end; admins and members may have no end date.
ALTER TABLE site_users DROP CONSTRAINT IF EXISTS site_users_guest_end_check;
ALTER TABLE site_users ADD CONSTRAINT site_users_guest_end_check CHECK (role <> 'guest' OR expires_at IS NOT NULL);
ALTER TABLE site_users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

COMMENT ON TABLE site_users IS 'Website logins managed on the Admin page (admins, members and guests). Owners are in AUTH_USERS; the super admin is SUPER_ADMIN.';

ALTER TABLE access_log DROP CONSTRAINT IF EXISTS access_log_event_check;
ALTER TABLE access_log ADD CONSTRAINT access_log_event_check CHECK (event IN (
  'login', 'login_failed', 'logout', 'page', 'blocked',
  'user_added', 'user_changed', 'user_removed', 'password_changed'
));
ALTER TABLE access_log ADD COLUMN IF NOT EXISTS detail text;   -- admin actions: what was done, to whom

COMMENT ON TABLE access_log IS 'Audit log: sign-ins, failed attempts, sign-outs, page views, and admin actions on logins.';
