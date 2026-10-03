// Retry queue + dead-letter queue for records that could not be ingested.
//
// A failed record gets ONE open row in sync_failures (status `pending`). Later
// runs re-fetch it from CT.gov by NCT ID and try again, with growing gaps
// (12 h, 1 d, 2 d, 4 d … max 7 d). After SYNC_MAX_ATTEMPTS failures in a row it
// moves to `dead` — the dead-letter queue shown on the Admin page — where a
// person can re-queue or dismiss it. Any later success marks it `resolved`.

import { pool } from "./db.js";
import { NCT_RE } from "./validate.js";

export const MAX_ATTEMPTS = Math.max(1, Number(process.env.SYNC_MAX_ATTEMPTS ?? 5));

export type FailureType = "validation" | "map_or_upsert" | "fetch";

/** Record a failed attempt for one trial (creates or updates its open entry). */
export async function recordFailure(nctId: string, type: FailureType, message: string, runId: string | null): Promise<void> {
  const id = (nctId || "UNKNOWN").slice(0, 40);
  // Records without a usable NCT ID can't be re-fetched: straight to dead-letter.
  const refetchable = NCT_RE.test(id);
  await pool.query(
    `INSERT INTO sync_failures (nct_id, failure_type, error_msg, retry_count, last_attempted, status,
                                first_failed_at, next_attempt_at, last_run_id)
     VALUES ($1, $2, $3, 0, now(), CASE WHEN $5 AND $4 > 1 THEN 'pending' ELSE 'dead' END,
             now(), now() + interval '12 hours', $6)
     ON CONFLICT (nct_id) WHERE status IN ('pending', 'dead') DO UPDATE SET
       failure_type    = EXCLUDED.failure_type,
       error_msg       = EXCLUDED.error_msg,
       retry_count     = sync_failures.retry_count + 1,
       last_attempted  = now(),
       last_run_id     = EXCLUDED.last_run_id,
       status          = CASE WHEN sync_failures.status = 'dead' OR sync_failures.retry_count + 2 >= $4
                              THEN 'dead' ELSE 'pending' END,
       next_attempt_at = now() + least(interval '12 hours' * power(2, sync_failures.retry_count + 1),
                                       interval '7 days')`,
    [id, type, message.slice(0, 2000), MAX_ATTEMPTS, refetchable, runId],
  );
}

/** Mark open entries (pending or dead) as resolved — e.g. after a successful ingest. */
export async function resolveFailures(nctIds: string[], resolution: string): Promise<number> {
  if (!nctIds.length) return 0;
  const r = await pool.query(
    `UPDATE sync_failures SET status = 'resolved', resolved_at = now(), resolution = $2
      WHERE status IN ('pending', 'dead') AND nct_id = ANY($1)`,
    [nctIds, resolution],
  );
  return r.rowCount ?? 0;
}

/** NCT IDs that currently have an open (pending or dead) entry. */
export async function openFailureIds(): Promise<Set<string>> {
  const r = await pool.query<{ nct_id: string }>(
    "SELECT nct_id FROM sync_failures WHERE status IN ('pending', 'dead')",
  );
  return new Set(r.rows.map((x) => x.nct_id));
}

/** Pending entries whose next attempt is due. */
export async function dueFailures(limit = 500): Promise<string[]> {
  const r = await pool.query<{ nct_id: string }>(
    `SELECT nct_id FROM sync_failures
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY next_attempt_at NULLS FIRST LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => x.nct_id).filter((id) => NCT_RE.test(id));
}

/** Put a dead (or pending) entry back in the queue, due now, with a fresh attempt count. */
export async function requeueFailure(nctId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE sync_failures SET status = 'pending', retry_count = 0, next_attempt_at = now()
      WHERE nct_id = $1 AND status IN ('pending', 'dead')`,
    [nctId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Ignore an open entry. */
export async function dismissFailure(nctId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE sync_failures SET status = 'dismissed', resolved_at = now(), resolution = 'dismissed by a person'
      WHERE nct_id = $1 AND status IN ('pending', 'dead')`,
    [nctId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function failureCounts(): Promise<{ pending: number; dead: number }> {
  const r = await pool.query<{ pending: number; dead: number }>(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'dead')::int    AS dead
       FROM sync_failures`,
  );
  return r.rows[0] ?? { pending: 0, dead: 0 };
}
