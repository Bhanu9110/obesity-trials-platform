-- 0015_site_users.sql
-- Guest logins become "site users": every login except the owner accounts in
-- Vercel's AUTH_USERS is managed on the Admin page (Users & access).
--   role 'member' : every page except Admin, may edit drug profiles; optional end date
--   role 'guest'  : only the chosen pages, view-only; always has an end date
-- password_enc keeps the password encrypted (AES-GCM, key derived from AUTH_SECRET)
-- so an admin can see or copy it again; password_hash is what sign-in checks.

DO $$
BEGIN
  IF to_regclass('public.site_users') IS NULL AND to_regclass('public.guest_access') IS NOT NULL THEN
    ALTER TABLE guest_access RENAME TO site_users;
    ALTER SEQUENCE IF EXISTS guest_access_id_seq RENAME TO site_users_id_seq;
    ALTER INDEX IF EXISTS idx_guest_access_expires RENAME TO idx_site_users_expires;
  END IF;
END $$;

ALTER TABLE site_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'guest';
ALTER TABLE site_users ADD COLUMN IF NOT EXISTS password_enc text;
ALTER TABLE site_users ALTER COLUMN expires_at DROP NOT NULL;   -- NULL = no end date (members only)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_users_role_check') THEN
    ALTER TABLE site_users ADD CONSTRAINT site_users_role_check CHECK (role IN ('member', 'guest'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_users_guest_end_check') THEN
    ALTER TABLE site_users ADD CONSTRAINT site_users_guest_end_check CHECK (role = 'member' OR expires_at IS NOT NULL);
  END IF;
END $$;

COMMENT ON TABLE site_users IS 'Website logins managed on the Admin page (members and guests). Owners are in AUTH_USERS.';
COMMENT ON COLUMN site_users.pages IS 'Guests only: pages they may open (Admin is never possible for guests).';

ALTER TABLE site_users ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON site_users FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE site_users_id_seq FROM anon, authenticated';
  END IF;
END $$;
