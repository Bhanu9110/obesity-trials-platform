import { NextRequest, NextResponse } from "next/server";
import { currentUser, mayAdminister } from "@/lib/admin";
import { configuredUsers, displayUsername, isGuest, isSiteUser, plainName } from "@/lib/auth";
import { listUsers } from "@/lib/site-users";
import { query } from "@/lib/db";
import { displayTimeZone } from "@/lib/queries";

export const dynamic = "force-dynamic";

export interface AccessMember {
  username: string;
  display: string;           // how the name is shown (owners keep their capitals)
  allowed: boolean;          // can still sign in (owner in AUTH_USERS, or an active site login)
  role: "owner" | "member" | "guest";
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
      query<Omit<AccessMember, "allowed" | "role" | "display">>(
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
    const owners = configuredUsers();
    const active = new Map(
      (await listUsers().catch(() => [])).filter((u) => u.status === "active").map((u) => [u.username, u.role]),
    );
    const seen = new Set(members.map((m) => m.username));
    const all: AccessMember[] = [
      ...members.map((m) => {
        const display = displayUsername(m.username);
        if (!isSiteUser(m.username)) return { ...m, display, role: "owner" as const, allowed: owners.includes(m.username) };
        const role = isGuest(m.username) ? ("guest" as const) : ("member" as const);
        return { ...m, display, role, allowed: active.get(plainName(m.username)) === role };
      }),
      ...owners.filter((u) => !seen.has(u)).map((u) => ({
        username: u, display: displayUsername(u), role: "owner" as const, allowed: true, last_seen: null, last_login: null, logins_30d: 0, pages_30d: 0,
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

/**
 * Remove someone who can no longer sign in from this list: deletes their rows
 * from the access log. ?username=… (as stored, e.g. "guest:rahul"). Owners only.
 */
export async function DELETE(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return NextResponse.json({ error: "Only admins can do this." }, { status: 403 });
  const name = (req.nextUrl.searchParams.get("username") ?? "").trim();
  if (!name) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  if (configuredUsers().includes(name)) {
    return NextResponse.json({ error: "Owner accounts can't be removed here — they are set in Vercel." }, { status: 400 });
  }
  if (isSiteUser(name)) {
    const still = (await listUsers().catch(() => [])).find((u) => u.username === plainName(name) && u.status === "active");
    if (still) return NextResponse.json({ error: "This login is still active — revoke or delete it under Users & access first." }, { status: 400 });
  }
  const rows = await query<{ n: number }>(
    `WITH d AS (DELETE FROM access_log WHERE username = $1 RETURNING 1) SELECT count(*)::int AS n FROM d`, [name],
  );
  return NextResponse.json({ removed: rows[0]?.n ?? 0 });
}
