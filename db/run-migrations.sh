#!/usr/bin/env bash
# run-migrations.sh — tracked, transactional schema migrations.
#
#   DATABASE_URL=postgres://user:pass@host:5432/db ./db/run-migrations.sh           # apply pending
#   DATABASE_URL=...                               ./db/run-migrations.sh --status  # list status
#
# How it works
#   * Migrations are db/migrations/NNNN_name.sql, applied in numeric order.
#   * Each one runs ONCE, inside its own transaction, and is recorded in
#     schema_migrations (version, name, sha256 checksum, applied_at, duration).
#   * A Postgres advisory lock serialises concurrent runners (e.g. local Docker
#     and the GitHub Actions job pointed at the same database).
#   * Editing an already-applied migration is detected (checksum mismatch) and
#     reported as a warning — add a NEW migration instead of changing an old one.
#   * Migration files must NOT contain their own BEGIN/COMMIT.
#
# Databases created before tracking existed: 0001–0006 are idempotent, so the
# first tracked run simply re-applies and records them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$HERE/migrations"
: "${DATABASE_URL:?Set DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/obesity_trials}"

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)
LOCK_KEY=727274001   # arbitrary constant shared by every runner of this project

sha() { sha256sum "$1" | cut -d' ' -f1; }

# Bootstrap the tracking table (idempotent).
"${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version       text PRIMARY KEY,           -- "0007"
  name          text NOT NULL,              -- "0007_ingestion_lineage.sql"
  checksum      text NOT NULL,              -- sha256 of the file when applied
  applied_at    timestamptz NOT NULL DEFAULT now(),
  execution_ms  int
);
SQL

mapfile -t FILES < <(find "$MIG_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' | sort)
if [[ ${#FILES[@]} -eq 0 ]]; then echo "No migrations found in $MIG_DIR" >&2; exit 1; fi

if [[ "${1:-}" == "--status" ]]; then
  echo "==> Migration status"
  for f in "${FILES[@]}"; do
    v="${f%%_*}"
    row=$("${PSQL[@]}" -tA -c "SELECT checksum || '|' || to_char(applied_at, 'YYYY-MM-DD HH24:MI') FROM schema_migrations WHERE version = '$v'")
    if [[ -z "$row" ]]; then
      echo "    pending   $f"
    elif [[ "${row%%|*}" != "$(sha "$MIG_DIR/$f")" ]]; then
      echo "    CHANGED   $f  (applied ${row#*|}; file edited since)"
    else
      echo "    applied   $f  (${row#*|})"
    fi
  done
  exit 0
fi

# Build one psql script: take the lock, then for every file apply it only if its
# version is not recorded yet — in a transaction together with its record.
SCRIPT="$(mktemp)"
trap 'rm -f "$SCRIPT"' EXIT
{
  echo "\\set ON_ERROR_STOP 1"
  echo "SELECT pg_advisory_lock($LOCK_KEY);"
  for f in "${FILES[@]}"; do
    v="${f%%_*}"
    sum="$(sha "$MIG_DIR/$f")"
    cat <<SQL
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '$v') AS pending \\gset
\\if :pending
  \\echo '    applying $f'
  SELECT clock_timestamp() AS t0 \\gset
  BEGIN;
  \\i '$MIG_DIR/$f'
  INSERT INTO schema_migrations (version, name, checksum, execution_ms)
  VALUES ('$v', '$f', '$sum', (extract(epoch FROM clock_timestamp() - :'t0'::timestamptz) * 1000)::int);
  COMMIT;
\\endif
SQL
  done
  echo "SELECT pg_advisory_unlock($LOCK_KEY);"
} > "$SCRIPT"

echo "==> Applying pending migrations"
OUT="$(mktemp)"
trap 'rm -f "$SCRIPT" "$OUT"' EXIT
if ! "${PSQL[@]}" -f "$SCRIPT" > "$OUT" 2>&1; then
  cat "$OUT" >&2
  echo "==> Migration FAILED — the failing migration was rolled back; nothing after it was applied." >&2
  exit 1
fi
grep -E '^ +applying ' "$OUT" || echo "    (nothing pending)"
grep -iE 'warning|error' "$OUT" >&2 || true

# Warn about edited migrations.
changed=0
while IFS='|' read -r v name sum; do
  [[ -z "$v" ]] && continue
  if [[ -f "$MIG_DIR/$name" && "$(sha "$MIG_DIR/$name")" != "$sum" ]]; then
    echo "WARNING: $name was edited after it was applied (checksum differs). Add a new migration instead." >&2
    changed=1
  fi
done < <("${PSQL[@]}" -tA -F'|' -c "SELECT version, name, checksum FROM schema_migrations ORDER BY version")

total=$("${PSQL[@]}" -tA -c "SELECT count(*) FROM schema_migrations")
echo "==> Done. $total migration(s) recorded in schema_migrations.$([[ $changed -eq 1 ]] && echo ' (see warnings)')"
