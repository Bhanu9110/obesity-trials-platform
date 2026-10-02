-- 0008_lock_down_api_access.sql
-- Supabase automatically publishes every table in the `public` schema through its
-- Data API (PostgREST), readable/writable with the project's public "anon" key.
-- This platform never uses that API — the website and sync connect to Postgres
-- directly as the owner role, which is NOT affected by anything below.
--
-- So we close that door:
--   * Row Level Security ON for every table, with no policies  -> API sees nothing
--   * the summary view runs with the caller's rights (security_invoker)
--   * API roles (anon / authenticated, Supabase only) lose all grants, now and for
--     tables created later
--   * helper functions are not executable by PUBLIC
-- On local Docker / Neon there are no API roles; RLS is harmless for the owner.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

ALTER VIEW data_quality_summary SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION continent_of(text)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION continents_of(text[]) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$;
