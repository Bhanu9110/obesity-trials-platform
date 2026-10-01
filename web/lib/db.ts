import { Pool } from "pg";

// Reuse a single pool across hot reloads in dev.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://postgres@localhost:5432/obesity_trials",
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

export async function query<T = any>(text: string, params?: unknown[]) {
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}
