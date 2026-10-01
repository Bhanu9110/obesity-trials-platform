-- 0001_extensions.sql
-- pgcrypto -> gen_random_uuid() (used by the sync run log tables).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMIT;
