-- 0013_guest_access.sql
-- Temporary, view-only logins for testers and prospects, created and revoked by an
-- admin on the Admin page (no Vercel change or redeploy needed). A guest can browse
-- trials, drugs and changes until expires_at; they cannot edit or merge drugs, see
-- Data quality or open the Admin page. Passwords are stored only as PBKDF2 hashes.

CREATE TABLE IF NOT EXISTS guest_access (
  id             bigserial   PRIMARY KEY,
  username       text        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  label          text        NOT NULL,          -- who it is for, e.g. "Rahul – Novo CI team"
  password_hash  text        NOT NULL,          -- pbkdf2-sha256$<iterations>$<salt>$<hash>
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  last_login_at  timestamptz,
  login_count    int         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_guest_access_expires ON guest_access (expires_at DESC);

COMMENT ON TABLE guest_access IS 'Temporary view-only website logins (Admin → Guest access).';

-- Same lock-down as every other table (0008): not reachable through Supabase's Data API.
ALTER TABLE guest_access ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON guest_access FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE guest_access_id_seq FROM anon, authenticated';
  END IF;
END $$;
