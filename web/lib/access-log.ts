// Access log: who signs in, who fails to, and which pages members open.
// Writing to it must never break the website — every write swallows its errors.
import type { NextRequest } from "next/server";
import { query } from "./db";

export type AccessEvent = "login" | "login_failed" | "logout" | "page" | "blocked";

/** Failed sign-ins from one IP address within the window before it is blocked. */
export const MAX_FAILURES = 8;
export const FAILURE_WINDOW_MIN = 15;
const KEEP_DAYS = 180;

export interface RequestInfo {
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

/** Visitor details from the request (Vercel adds the geo headers). */
export function requestInfo(req: NextRequest): RequestInfo {
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const dec = (v: string | null) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return v; }
  };
  return {
    ip: clip(ip, 64),
    country: clip(h.get("x-vercel-ip-country"), 8),
    region: clip(dec(h.get("x-vercel-ip-country-region")), 64),
    city: clip(dec(h.get("x-vercel-ip-city")), 64),
    userAgent: clip(h.get("user-agent"), 300),
  };
}

export async function logAccess(event: AccessEvent, username: string | null, req: NextRequest, path?: string): Promise<void> {
  const i = requestInfo(req);
  try {
    await query(
      `INSERT INTO access_log (event, username, path, ip, country, region, city, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event, clip(username?.trim().toLowerCase(), 60), clip(path, 200), i.ip, i.country, i.region, i.city, i.userAgent],
    );
    // Keep the table small: an occasional clean-up of old rows.
    if (event === "login" && Math.random() < 0.2) {
      await query(`DELETE FROM access_log WHERE at < now() - make_interval(days => ${KEEP_DAYS})`);
    }
  } catch (err) {
    console.error("[access-log] not recorded:", (err as Error)?.message);
  }
}

/** Too many failed sign-ins from this IP recently? (Fails open if the database is down.) */
export async function tooManyFailures(req: NextRequest): Promise<boolean> {
  const { ip } = requestInfo(req);
  if (!ip) return false;
  try {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM access_log
        WHERE event = 'login_failed' AND ip = $1 AND at > now() - make_interval(mins => ${FAILURE_WINDOW_MIN})`,
      [ip],
    );
    return (rows[0]?.n ?? 0) >= MAX_FAILURES;
  } catch {
    return false;
  }
}
