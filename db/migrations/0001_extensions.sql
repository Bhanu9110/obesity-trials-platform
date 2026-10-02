-- 0001_extensions.sql
-- pgcrypto -> gen_random_uuid() (used by the sync run log tables).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
