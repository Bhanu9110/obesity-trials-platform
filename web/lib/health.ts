// Health of the data pipeline as seen from the website (same thresholds as
// sync/src/health.ts). Used by /api/health (public, minimal) and the Admin page.
import { query } from "./db";

/** Latest migration the website needs. Keep in step with sync/src/health.ts. */
export const REQUIRED_SCHEMA_VERSION = "0013";
export const SYNC_AGE = { warn: 36, fail: 72 }; // hours since the last successful sync

export type HealthStatus = "ok" | "warn" | "fail";
export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
}
export interface Health {
  status: HealthStatus;
  checkedAt: string;
  lastSuccessfulSync: string | null;
  hoursSinceSync: number | null;
  checks: HealthCheck[];
}

/** "session" / "transaction" for a Supabase pooler URL, otherwise null. */
export function poolerMode(url: string | undefined): "session" | "transaction" | null {
  try {
    const u = new URL(url ?? "");
    if (!/\.pooler\.supabase\.com$/i.test(u.hostname)) return null;
    return u.port === "6543" ? "transaction" : "session";
  } catch {
    return null;
  }
}

export async function getHealth(): Promise<Health> {
  const checks: HealthCheck[] = [];
  const now = new Date();
  let dbError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await query("SELECT 1");
      dbError = null;
      break;
    } catch (err) {
      dbError = err;
    }
  }
  if (dbError) {
    const e = dbError as { code?: string; message?: string };
    // Short reason only (never the connection string).
    const reason = `${e.code ? e.code + ": " : ""}${(e.message ?? String(dbError)).replace(/postgres(ql)?:\/\/\S+/gi, "[url]").slice(0, 160)}`;
    checks.push({ name: "database", status: "fail", detail: `not reachable (${reason})` });
    return { status: "fail", checkedAt: now.toISOString(), lastSuccessfulSync: null, hoursSinceSync: null, checks };
  }
  checks.push({ name: "database", status: "ok", detail: "reachable" });

  // On Vercel every server instance opens its own connections. Supabase's session
  // pooler (port 5432) allows only ~15 clients in total and then refuses with
  // EMAXCONNSESSION; the transaction pooler (port 6543) is the one meant for this.
  const mode = poolerMode(process.env.DATABASE_URL);
  if (process.env.VERCEL && mode === "session") {
    checks.push({
      name: "connection",
      status: "warn",
      detail: "DATABASE_URL uses Supabase's session pooler (port 5432) — set it to the transaction pooler (port 6543) in Vercel to avoid 'max clients reached' errors",
    });
  }

  const [mig, last, latest, queue, trials] = await Promise.all([
    query<{ ok: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS ok",
      [REQUIRED_SCHEMA_VERSION],
    ).catch(() => [{ ok: false }]),
    query<{ run_at: string | null }>(
      "SELECT max(run_at) AS run_at FROM sync_runs WHERE status IN ('success','partial') AND mode IS DISTINCT FROM 'retry'",
    ),
    query<{ status: string; mode: string | null }>(
      "SELECT status, mode FROM sync_runs WHERE status <> 'running' ORDER BY run_at DESC LIMIT 1",
    ),
    query<{ pending: number; dead: number }>(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'dead')::int    AS dead FROM sync_failures`,
    ).catch(() => [{ pending: 0, dead: 0 }]),
    query<{ c: number }>("SELECT count(*)::int AS c FROM trials WHERE obesity_class = 'primary'")
      .catch(() => query<{ c: number }>("SELECT count(*)::int AS c FROM trials")),
  ]);

  checks.push(mig[0]?.ok
    ? { name: "migrations", status: "ok", detail: `schema ${REQUIRED_SCHEMA_VERSION} applied` }
    : { name: "migrations", status: "fail", detail: `migration ${REQUIRED_SCHEMA_VERSION} not applied yet — run the GitHub workflow` });

  const lastAt = last[0]?.run_at ? new Date(last[0].run_at) : null;
  const hours = lastAt ? (now.getTime() - lastAt.getTime()) / 3600_000 : null;
  if (hours == null) checks.push({ name: "last sync", status: "fail", detail: "no successful sync yet" });
  else {
    const status: HealthStatus = hours > SYNC_AGE.fail ? "fail" : hours > SYNC_AGE.warn ? "warn" : "ok";
    checks.push({ name: "last sync", status, detail: `${hours.toFixed(1)} hours ago` });
  }
  if (latest[0]?.status === "failed") {
    checks.push({ name: "latest run", status: "warn", detail: `the latest ${latest[0].mode ?? ""} run failed`.replace("  ", " ") });
  }
  const { pending, dead } = queue[0] ?? { pending: 0, dead: 0 };
  checks.push(dead > 0
    ? { name: "failed records", status: "warn", detail: `${dead} in the dead-letter queue, ${pending} waiting for retry` }
    : { name: "failed records", status: pending > 50 ? "warn" : "ok", detail: `${pending} waiting for retry` });
  checks.push({ name: "trials", status: (trials[0]?.c ?? 0) > 0 ? "ok" : "fail", detail: `${trials[0]?.c ?? 0} primary-obesity trials` });

  const status: HealthStatus = checks.some((c) => c.status === "fail") ? "fail"
    : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return {
    status,
    checkedAt: now.toISOString(),
    lastSuccessfulSync: lastAt ? lastAt.toISOString() : null,
    hoursSinceSync: hours == null ? null : Math.round(hours * 10) / 10,
    checks,
  };
}
