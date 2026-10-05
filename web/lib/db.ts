import { Pool, type PoolConfig } from "pg";

/**
 * node-postgres settings from a connection string (same logic as sync/src/db.ts).
 * node-postgres treats `sslmode=require` as "verify against public CAs", which
 * fails for Supabase (its own CA) — and an `ssl` option is ignored while
 * `sslmode` is in the URL. For Supabase / `sslmode=no-verify` we strip the URL's
 * ssl* parameters and set SSL explicitly; with DATABASE_CA_CERT the certificate
 * is verified too. Other hosts keep their URL unchanged.
 */
export function pgConfig(url: string, max: number): PoolConfig {
  const ca = (process.env.DATABASE_CA_CERT ?? "").replace(/\\n/g, "\n").trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { connectionString: url, max };
  }
  const mode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
  const isSupabase = /(^|\.)supabase\.(co|com)$/i.test(u.hostname);

  let ssl: PoolConfig["ssl"];
  if (ca && mode !== "disable") ssl = { ca, rejectUnauthorized: true };
  else if (mode === "no-verify" || (isSupabase && mode !== "disable")) ssl = { rejectUnauthorized: false };
  else return { connectionString: url, max };

  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl, max };
}

// Reuse a single pool across hot reloads in dev.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

// Serverless (Vercel): every warm instance has its own pool, so keep it tiny and
// use Supabase's *transaction* pooler (port 6543). Local / Docker: a few more.
const defaultMax = process.env.VERCEL ? 2 : 5;

export const pool =
  globalForPg.pgPool ??
  new Pool({
    ...pgConfig(
      process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/obesity_trials",
      Number(process.env.PG_POOL_MAX ?? defaultMax),
    ),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });

// A pooled connection can be closed by the database side while the serverless
// function is frozen between requests. Never let that crash the process.
if (!(pool as any).__errorHandler) {
  pool.on("error", () => { /* the broken client is discarded by the pool */ });
  (pool as any).__errorHandler = true;
}

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

/** Errors that mean "this connection is dead", not "this query is wrong". */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  const msg = (e?.message ?? "").toLowerCase();
  return (
    ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "57P01", "57P02", "57P03"].includes(code) ||
    code.startsWith("08") ||
    msg.includes("connection terminated") ||
    msg.includes("terminating connection") ||
    msg.includes("client has encountered a connection error") ||
    msg.includes("connection timeout") ||
    msg.includes("server closed the connection")
  );
}

/** The database (or Supabase's pooler) is briefly full: worth a short wait and retry. */
export function isCapacityError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "53300" || // too_many_connections
    msg.includes("max client connections") ||
    msg.includes("max clients reached") || // Supabase session pooler: EMAXCONNSESSION
    msg.includes("emaxconn") ||
    msg.includes("too many clients") ||
    msg.includes("remaining connection slots") ||
    msg.includes("timeout exceeded when trying to connect")
  );
}

/**
 * The database refused the website's login: wrong password / user in DATABASE_URL.
 * Supabase's pooler answers repeated failures with ECIRCUITBREAKER and blocks new
 * connections for a while, so retrying only makes it worse.
 */
export function isAuthError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "28P01" || e?.code === "28000" ||
    msg.includes("password authentication failed") ||
    msg.includes("ecircuitbreaker") ||
    msg.includes("authentication failures") ||
    msg.includes("tenant or user not found")
  );
}

const AUTH_COOLDOWN_MS = 60_000;
let authBlockedUntil = 0;
let lastAuthError = "";

function authFailure(detail: string): Error {
  return new Error(
    "The website can't sign in to the database — the password (or user name) in DATABASE_URL in Vercel is wrong. " +
      "Fix it in Vercel → Settings → Environment Variables and redeploy. (" + detail + ")",
  );
}

/**
 * Run a query. A query that fails because its pooled connection had gone stale
 * (common on Vercel after the function was idle) or because the pooler was briefly
 * full is retried up to twice, with a short pause, before the error is shown.
 */
export async function query<T = any>(text: string, params?: unknown[]) {
  // After a login failure, don't touch the database for a minute: every new attempt
  // with a wrong password keeps Supabase's block (ECIRCUITBREAKER) switched on.
  if (Date.now() < authBlockedUntil) throw authFailure(lastAuthError);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await pool.query(text, params as any[]);
      return res.rows as T[];
    } catch (err) {
      if (isAuthError(err)) {
        lastAuthError = ((err as Error)?.message ?? "").slice(0, 160);
        authBlockedUntil = Date.now() + AUTH_COOLDOWN_MS;
        console.error("[db] database login refused:", lastAuthError);
        throw authFailure(lastAuthError);
      }
      const retryable = isConnectionError(err) || isCapacityError(err);
      if (!retryable || attempt >= 2) {
        console.error("[db] query failed", (err as { code?: string })?.code ?? "", (err as Error)?.message);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1) ** 2));
    }
  }
}
