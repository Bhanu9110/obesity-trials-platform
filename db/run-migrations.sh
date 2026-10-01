#!/usr/bin/env bash
# run-migrations.sh — apply all migrations in order. Every migration is idempotent,
# so this is safe to run on every start (docker compose runs it each time).
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./db/run-migrations.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DATABASE_URL:?Set DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/obesity_trials}"

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

echo "==> Applying schema migrations"
for f in \
  0001_extensions.sql \
  0002_core_schema.sql \
  0003_sync_audit.sql \
  0004_country_continent.sql \
  0005_slim_existing.sql \
  0006_indexes.sql ; do
  echo "    - $f"
  "${PSQL[@]}" -f "$HERE/migrations/$f"
done

echo "==> Done."
