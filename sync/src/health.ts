// Health checks for the data pipeline. Used by `npm run health` (and the daily
// GitHub job, which fails — and emails you — when a check fails).
//
//   ok    all good
//   warn  worth a look, but the data is usable
//   fail  something is broken (the command exits with code 1)

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pool } from "./db.js";
import { MAX_ATTEMPTS } from "./failures.js";

/** Latest migration this code needs. Update when adding a migration. */
export const REQUIRED_SCHEMA_VERSION = "0013";

export type HealthStatus = "ok" | "warn" | "fail";
export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
}
export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
}

const HOURS = 3600_000;

/** Thresholds (hours since the last successful sync). */
export const SYNC_AGE = { warn: 36, fail: 72 };

function worst(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

export async function checkHealth(now: Date = new Date()): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const add = (name: string, status: HealthStatus, detail: string) => checks.push({ name, status, detail });

  // 1. Database reachable
  try {
    await pool.query("SELECT 1");
    add("database", "ok", "reachable");
  } catch (err) {
    add("database", "fail", `not reachable: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "fail", checkedAt: now.toISOString(), checks };
  }

  // 2. Migrations
  try {
    const r = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
    const applied = new Set(r.rows.map((x) => x.version));
    const dir = path.resolve(process.cwd(), "..", "db", "migrations");
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4))
      : [REQUIRED_SCHEMA_VERSION];
    const pending = files.filter((v) => !applied.has(v));
    if (!applied.has(REQUIRED_SCHEMA_VERSION) || pending.length) {
      add("migrations", "fail", `not applied: ${[...new Set([...pending, REQUIRED_SCHEMA_VERSION])].filter((v) => !applied.has(v)).join(", ")} — run the migrations`);
    } else {
      add("migrations", "ok", `${applied.size} applied`);
    }
  } catch {
    add("migrations", "fail", "schema_migrations table missing — run the migrations");
  }

  // 3. Last successful sync
  const last = await pool.query<{ run_at: Date | null }>(
    "SELECT max(run_at) AS run_at FROM sync_runs WHERE status IN ('success','partial') AND mode IS DISTINCT FROM 'retry'",
  );
  const lastAt = last.rows[0]?.run_at;
  if (!lastAt) add("last sync", "fail", "no successful sync yet");
  else {
    const hours = (now.getTime() - new Date(lastAt).getTime()) / HOURS;
    const status: HealthStatus = hours > SYNC_AGE.fail ? "fail" : hours > SYNC_AGE.warn ? "warn" : "ok";
    add("last sync", status, `${hours.toFixed(1)} h ago (${new Date(lastAt).toISOString()})`);
  }

  // 4. Most recent run
  const recent = await pool.query<{ status: string; mode: string | null; error_detail: any }>(
    "SELECT status, mode, error_detail FROM sync_runs WHERE status <> 'running' ORDER BY run_at DESC LIMIT 1",
  );
  const rr = recent.rows[0];
  if (rr?.status === "failed") add("latest run", "warn", `failed (${rr.mode ?? "?"}): ${JSON.stringify(rr.error_detail ?? {}).slice(0, 200)}`);
  else if (rr) add("latest run", "ok", `${rr.status} (${rr.mode ?? "?"})`);

  // 5. Data present
  const counts = await pool.query<{ total: number; primary: number }>(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE obesity_class = 'primary')::int AS primary FROM trials",
  ).catch(() => pool.query<{ total: number; primary: number }>("SELECT count(*)::int AS total, count(*)::int AS primary FROM trials"));
  const { total, primary } = counts.rows[0];
  add("trials", primary > 0 ? "ok" : "fail", `${primary} primary-obesity trials (${total} stored)`);

  // 6. Retry / dead-letter queue
  try {
    const f = await pool.query<{ pending: number; dead: number }>(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'dead')::int    AS dead FROM sync_failures`,
    );
    const { pending, dead } = f.rows[0];
    if (dead > 0) add("failed records", "warn", `${dead} in the dead-letter queue (failed ${MAX_ATTEMPTS}×) — see Admin page; ${pending} waiting for retry`);
    else if (pending > 50) add("failed records", "warn", `${pending} waiting for retry`);
    else add("failed records", "ok", `${pending} waiting for retry, none dead`);
  } catch {
    /* table from an older schema — covered by the migrations check */
  }

  // 7. Safety guard tripped?
  const guard = await pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'prune_skipped'");
  if (guard.rows[0]) {
    const g = JSON.parse(guard.rows[0].value);
    add("removal guard", "warn", `last full sync did not remove ${g.count} trial(s) CT.gov stopped returning (limit ${g.limit}) — check, then run once with SYNC_ALLOW_LARGE_PRUNE=true`);
  }

  return { status: worst(checks), checkedAt: now.toISOString(), checks };
}

export function formatHealth(r: HealthReport): string {
  const icon = { ok: "OK  ", warn: "WARN", fail: "FAIL" } as const;
  return [
    `Health: ${r.status.toUpperCase()}  (${r.checkedAt})`,
    ...r.checks.map((c) => `  [${icon[c.status]}] ${c.name.padEnd(15)} ${c.detail}`),
  ].join("\n");
}
