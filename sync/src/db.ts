import pg from "pg";
import { config } from "./config.js";

/**
 * Build node-postgres settings from a connection string.
 *
 * Why: node-postgres treats `sslmode=require` as "verify the certificate against
 * the public CAs". Supabase signs its certificates with its own CA, so a plain
 * Supabase URL fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE — and an `ssl` option
 * is ignored while `sslmode` is still in the URL. So for Supabase (or
 * `sslmode=no-verify`) we drop the URL's ssl* parameters and set SSL explicitly:
 *   - DATABASE_CA_CERT set (the CA certificate text from Supabase) -> encrypted AND verified
 *   - otherwise                                                    -> encrypted, not verified
 * Other hosts (local Docker, Neon, ...) keep their URL unchanged.
 */
export function pgConfig(url: string, max = 5): pg.PoolConfig {
  const ca = (process.env.DATABASE_CA_CERT ?? "").replace(/\\n/g, "\n").trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { connectionString: url, max };
  }
  const mode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
  const isSupabase = /(^|\.)supabase\.(co|com)$/i.test(u.hostname);

  let ssl: pg.PoolConfig["ssl"];
  if (ca && mode !== "disable") ssl = { ca, rejectUnauthorized: true };
  else if (mode === "no-verify" || (isSupabase && mode !== "disable")) ssl = { rejectUnauthorized: false };
  else return { connectionString: url, max };

  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl, max };
}

// A single shared pool for the sync process.
export const pool = new pg.Pool(pgConfig(config.databaseUrl, 5));

export type Client = pg.PoolClient;

/** Run `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
