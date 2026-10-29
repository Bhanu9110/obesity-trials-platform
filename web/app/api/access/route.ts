import { NextRequest, NextResponse } from "next/server";
import { currentUser, isSuperAdmin, mayAdminister, ownerLevel } from "@/lib/admin";
import { configuredUsers, displayUsername, isGuest, isSiteAdmin, isSiteUser, plainName } from "@/lib/auth";
import { listUsers } from "@/lib/site-users";
import { query } from "@/lib/db";
import { displayTimeZone } from "@/lib/queries";

export const dynamic = "force-dynamic";

const ownerRole = (u: string) => (ownerLevel(u) === "super" ? "super_admin" as const : ownerLevel(u) === "admin" ? "admin" as const : "owner" as const);

export interface AccessMember {
  username: string;
  display: string;           // how the name is shown (owners keep their capitals)
  allowed: boolean;          // can still sign in (owner in AUTH_USERS, or an active site login)
  role: "super_admin" | "owner" | "admin" | "member" | "guest";
  last_seen: string | null;  // in the display time zone, "YYYY-MM-DD HH:MM"
  last_login: string | null;
  idle_s: number | null;     // seconds since last activity
  login_idle_s: number | null;
  logins_30d: number;
  pages_30d: number;
  countries: string[];
  last_place: string | null;
  last_country: string | null;
  last_ip: string | null;
  last_agent: string | null;
}
export interface AccessEventRow {
  id: number;
  at: string;                 // "YYYY-MM-DD HH:MM:SS" in the display time zone
  event: string;
  username: string | null;
  path: string | null;
  detail: string | null;      // admin actions: what was done, to whom
  ip: string | null;
  place: string | null;
  country: string | null;
  user_agent: string | null;
}
export interface AccessStats {
  active7d: number; logins7d: number; loginsToday: number; pages7d: number;
  failed7d: number; failedIps7d: number; admin30d: number;
}
export type AccessKind = "all" | "logins" | "pages" | "failed" | "admin" | "exports";
export interface AccessResponse {
  members: AccessMember[];
  events: AccessEventRow[];
  hasMore: boolean;
  counts: Record<AccessKind, number>;
  stats: AccessStats;
  daily: { day: string; logins: number; pages: number; failed: number }[];
  topPages: { path: string; views: number; people: number }[];
  today: string;
  timeZone: string;
  canErase: boolean;
}

const KIND_SQL: Record<Exclude<AccessKind, "all">, string> = {
  logins: "event IN ('login', 'logout')",
  pages: "event = 'page'",
  failed: "event IN ('login_failed', 'blocked')",
  admin: "event IN ('user_added', 'user_changed', 'user_removed', 'password_changed')",
  exports: "event = 'export'",
};
const isKind = (k: string | null): k is Exclude<AccessKind, "all"> => !!k && Object.prototype.hasOwnProperty.call(KIND_SQL, k);
const PAGE = 50;
const PLACE = "nullif(concat_ws(', ', nullif(city, ''), nullif(region, ''), country), '')";

/**
 * The Audit logs page (admins and the super admin).
 * ?kind=logins|pages|failed|admin  ?user=<stored username>  ?q=<text in page, detail, IP or name>  ?before=<id> (older page)
 */
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!await mayAdminister(user)) return NextResponse.json({ error: "Only admins can see the access log." }, { status: 403 });
  const tz = displayTimeZone();
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const who = (sp.get("user") ?? "").trim().slice(0, 120);
  const text = (sp.get("q") ?? "").trim().slice(0, 120);
  const before = Number(sp.get("before")) || 0;

  // Filters shared by the list and the tab counts (person + text); the tab adds its own.
  const params: unknown[] = [tz];
  const base: string[] = [];
  if (who) { params.push(who); base.push(`username = $${params.length}`); }
  if (text) {
    params.push(`%${text.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    const i = params.length;
    base.push(`(coalesce(path, '') ILIKE $${i} OR coalesce(to_jsonb(access_log) ->> 'detail', '') ILIKE $${i}
              OR coalesce(ip, '') ILIKE $${i} OR coalesce(username, '') ILIKE $${i} OR coalesce(city, '') ILIKE $${i})`);
  }
  const listWhere = [...base, ...(isKind(kind) ? [KIND_SQL[kind]] : [])];
  const listParams = [...params];
  // Older page: everything before the last entry shown (by time, then id, so entries never repeat or go missing).
  if (before) { listParams.push(before); listWhere.push(`(at, id) < (SELECT b.at, b.id FROM access_log b WHERE b.id = $${listParams.length})`); }
  const where = (c: string[]) => (c.length ? `WHERE ${c.join(" AND ")}` : "");

  try {
    const [members, events, counts, stats, daily, topPages] = await Promise.all([
      query<Omit<AccessMember, "allowed" | "role" | "display">>(
        `SELECT username,
                to_char(max(at) AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS last_seen,
                to_char(max(at) FILTER (WHERE event = 'login') AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS last_login,
                extract(epoch FROM now() - max(at))::int AS idle_s,
                extract(epoch FROM now() - max(at) FILTER (WHERE event = 'login'))::int AS login_idle_s,
                count(*) FILTER (WHERE event = 'login' AND at > now() - interval '30 days')::int AS logins_30d,
                count(*) FILTER (WHERE event = 'page'  AND at > now() - interval '30 days')::int AS pages_30d,
                coalesce(array_agg(DISTINCT country) FILTER (WHERE country IS NOT NULL), '{}') AS countries,
                (array_agg(${PLACE} ORDER BY at DESC) FILTER (WHERE coalesce(city, region, country) IS NOT NULL))[1] AS last_place,
                (array_agg(country ORDER BY at DESC) FILTER (WHERE country IS NOT NULL))[1] AS last_country,
                (array_agg(ip ORDER BY at DESC) FILTER (WHERE ip IS NOT NULL))[1] AS last_ip,
                (array_agg(user_agent ORDER BY at DESC) FILTER (WHERE user_agent IS NOT NULL))[1] AS last_agent
           FROM access_log
          WHERE username IS NOT NULL AND event IN ('login', 'page', 'logout')
          GROUP BY username
          ORDER BY max(at) DESC`,
        [tz],
      ),
      query<AccessEventRow>(
        `SELECT id, to_char(at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI:SS') AS at, event, username, path,
                to_jsonb(access_log) ->> 'detail' AS detail, ip, ${PLACE} AS place, country, user_agent
           FROM access_log ${where(listWhere)}
          ORDER BY at DESC, id DESC LIMIT ${PAGE + 1}`,
        listParams,
      ),
      query<Record<AccessKind, number> & { tz?: string }>(
        `SELECT $1::text AS tz, count(*)::int AS "all",
                ${Object.entries(KIND_SQL).map(([k, c]) => `count(*) FILTER (WHERE ${c})::int AS ${k}`).join(", ")}
           FROM access_log ${where(base)}`,
        params,
      ),
      query<AccessStats & { today: string }>(
        `SELECT count(DISTINCT username) FILTER (WHERE event IN ('login', 'page') AND at > now() - interval '7 days')::int AS "active7d",
                count(*) FILTER (WHERE event = 'login' AND at > now() - interval '7 days')::int AS "logins7d",
                count(*) FILTER (WHERE event = 'login' AND (at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date)::int AS "loginsToday",
                count(*) FILTER (WHERE event = 'page' AND at > now() - interval '7 days')::int AS "pages7d",
                count(*) FILTER (WHERE event IN ('login_failed', 'blocked') AND at > now() - interval '7 days')::int AS "failed7d",
                count(DISTINCT ip) FILTER (WHERE event IN ('login_failed', 'blocked') AND at > now() - interval '7 days')::int AS "failedIps7d",
                count(*) FILTER (WHERE ${KIND_SQL.admin})::int AS "admin30d",
                to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS today
           FROM access_log WHERE at > now() - interval '30 days'`,
        [tz],
      ),
      query<{ day: string; logins: number; pages: number; failed: number }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                count(a.id) FILTER (WHERE a.event = 'login')::int AS logins,
                count(a.id) FILTER (WHERE a.event = 'page')::int AS pages,
                count(a.id) FILTER (WHERE a.event IN ('login_failed', 'blocked'))::int AS failed
           FROM generate_series((now() AT TIME ZONE $1)::date - 13, (now() AT TIME ZONE $1)::date, interval '1 day') d
           LEFT JOIN access_log a ON (a.at AT TIME ZONE $1)::date = d::date AND a.at > now() - interval '15 days'
          GROUP BY d ORDER BY d`,
        [tz],
      ),
      query<{ path: string; views: number; people: number }>(
        `SELECT path, count(*)::int AS views, count(DISTINCT username)::int AS people
           FROM access_log WHERE event = 'page' AND path IS NOT NULL AND at > now() - interval '30 days'
          GROUP BY path ORDER BY views DESC, path LIMIT 8`,
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
        if (!isSiteUser(m.username)) return { ...m, display, role: ownerRole(m.username), allowed: owners.includes(m.username) };
        const role = isGuest(m.username) ? ("guest" as const) : isSiteAdmin(m.username) ? ("admin" as const) : ("member" as const);
        return { ...m, display, role, allowed: active.get(plainName(m.username)) === role };
      }),
      ...owners.filter((u) => !seen.has(u)).map((u) => ({
        username: u, display: displayUsername(u), role: ownerRole(u), allowed: true, last_seen: null, last_login: null,
        idle_s: null, login_idle_s: null, logins_30d: 0, pages_30d: 0,
        countries: [], last_place: null, last_country: null, last_ip: null, last_agent: null,
      })),
    ];
    const { today, ...st } = stats[0];
    const body: AccessResponse = {
      members: all, events: events.slice(0, PAGE), hasMore: events.length > PAGE,
      counts: { all: counts[0].all, logins: counts[0].logins, pages: counts[0].pages, failed: counts[0].failed, admin: counts[0].admin, exports: counts[0].exports },
      stats: st, daily, topPages, today, timeZone: tz, canErase: await isSuperAdmin(user),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "query failed";
    return NextResponse.json(
      { error: /access_log/.test(msg) ? "The audit log starts after the next sync adds its table (migration 0012)." : msg },
      { status: 500 },
    );
  }
}

/**
 * Remove someone who can no longer sign in from this list: deletes their rows
 * from the audit log. ?username=… (as stored, e.g. "guest:rahul"). Super admin only,
 * so admins can't erase what they did.
 */
export async function DELETE(req: NextRequest) {
  if (!(await isSuperAdmin(await currentUser(req)))) {
    return NextResponse.json({ error: "Only the super admin can remove audit log history." }, { status: 403 });
  }
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
