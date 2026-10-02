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
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

export async function query<T = any>(text: string, params?: unknown[]) {
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}
