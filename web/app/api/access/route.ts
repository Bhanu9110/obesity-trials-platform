import { NextRequest, NextResponse } from "next/server";
import { currentUser, mayAdminister } from "@/lib/admin";
import { configuredUsers } from "@/lib/auth";
import { query } from "@/lib/db";
import { displayTimeZone } from "@/lib/queries";

export const dynamic = "force-dynamic";

export interface AccessMember {
  username: string;
  allowed: boolean;          // still in AUTH_USERS
  last_seen: string | null;
  last_login: string | null;
  logins_30d: number;
  pages_30d: number;
  countries: string[];
  last_place: string | null;
  last_ip: string | null;
  last_agent: string | null;
}
export interface AccessEventRow {
  id: number;
  at: string;
  event: string;
  username: string | null;
  path: string | null;
  ip: string | null;
  place: string | null;
  user_agent: string | null;
}

/** The Admin page's access log (admins only). */
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!mayAdminister(user)) return NextResponse.json({ error: "Only admins can see the access log." }, { status: 403 });
  const tz = displayTimeZone();
  const kind = req.nextUrl.searchParams.get("kind");
  const filter =
    kind === "failed" ? "WHERE event IN ('login_failed', 'blocked')" :
    kind === "logins" ? "WHERE event IN ('login', 'logout', 'login_failed', 'blocked')" : "";
  try {
    const [members, events, failed] = await Promise.all([
      query<Omit<AccessMember, "allowed">>(
        `SELECT username,
                to_char(max(at) AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS last_seen,
                to_char(max(at) FILTER (WHERE event = 'login') AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS last_login,
                count(*) FILTER (WHERE event = 'login' AND at > now() - interval '30 days')::int AS logins_30d,
                count(*) FILTER (WHERE event = 'page'  AND at > now() - interval '30 days')::int AS pages_30d,
                coalesce(array_agg(DISTINCT country) FILTER (WHERE country IS NOT NULL), '{}') AS countries,
                (array_agg(concat_ws(', ', nullif(city, ''), nullif(region, ''), country) ORDER BY at DESC) FILTER (WHERE coalesce(city, region, country) IS NOT NULL))[1] AS last_place,
                (array_agg(ip ORDER BY at DESC) FILTER (WHERE ip IS NOT NULL))[1] AS last_ip,
                (array_agg(user_agent ORDER BY at DESC) FILTER (WHERE user_agent IS NOT NULL))[1] AS last_agent
           FROM access_log
          WHERE username IS NOT NULL AND event IN ('login', 'page', 'logout')
          GROUP BY username
          ORDER BY max(at) DESC`,
        [tz],
      ),
      query<AccessEventRow>(
        `SELECT id, to_char(at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI:SS') AS at, event, username, path, ip,
                nullif(concat_ws(', ', nullif(city, ''), nullif(region, ''), country), '') AS place, user_agent
           FROM access_log ${filter}
          ORDER BY access_log.at DESC LIMIT 200`,
        [tz],
      ),
      query<{ attempts: number; ips: number }>(
        `SELECT count(*)::int AS attempts, count(DISTINCT ip)::int AS ips FROM access_log
          WHERE event IN ('login_failed', 'blocked') AND at > now() - interval '7 days'`,
      ),
    ]);
    const allowed = configuredUsers();
    const seen = new Set(members.map((m) => m.username));
    const all: AccessMember[] = [
      ...members.map((m) => ({ ...m, allowed: allowed.includes(m.username) })),
      ...allowed.filter((u) => !seen.has(u)).map((u) => ({
        username: u, allowed: true, last_seen: null, last_login: null, logins_30d: 0, pages_30d: 0,
        countries: [], last_place: null, last_ip: null, last_agent: null,
      })),
    ];
    return NextResponse.json({ members: all, events, failed7d: failed[0] ?? { attempts: 0, ips: 0 }, timeZone: tz });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "query failed";
    return NextResponse.json(
      { error: /access_log/.test(msg) ? "The access log starts after the next sync adds its table (migration 0012)." : msg },
      { status: 500 },
    );
  }
}
