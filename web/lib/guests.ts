// Guest access: temporary, view-only logins created on the Admin page.
// Server-only (uses the database).
import { query } from "./db";
import {
  GUEST_PREFIX, GUEST_SESSION_MIN, configuredUsers, generatePassword, guestName, hashPassword, verifyPassword,
} from "./auth";
import { DEFAULT_GUEST_PAGES, cleanPages, type GuestPage } from "./guest-pages";

export type GuestStatus = "active" | "expired" | "revoked";

export interface Guest {
  id: number;
  username: string;
  label: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_login_at: string | null;
  login_count: number;
  pages: GuestPage[];
  status: GuestStatus;
}

/** How long a guest login can last, in minutes: 10 minutes … 30 days. */
export const GUEST_MINUTES = [10, 15, 30, 60, 120, 240, 480, 1440, 4320, 10080, 20160, 43200] as const;
const validMinutes = (m: number) => (GUEST_MINUTES as readonly number[]).includes(m);
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

const COLS = `id::int AS id, username, label, created_by, created_at, expires_at, revoked_at, last_login_at, login_count, pages,
  CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE 'active' END AS status`;

export async function listGuests(): Promise<Guest[]> {
  return query<Guest>(
    `SELECT ${COLS} FROM guest_access
      ORDER BY (revoked_at IS NULL AND expires_at > now()) DESC, created_at DESC LIMIT 200`,
  );
}

/** Creates a guest login; the password is returned once and only its hash is stored. */
export async function createGuest(opts: {
  label: string; username?: string; minutes: number; pages?: unknown; createdBy: string | null;
}) {
  const label = opts.label.trim().slice(0, 120);
  if (!label) throw new GuestError("Say who the login is for.");
  const pages = opts.pages === undefined ? DEFAULT_GUEST_PAGES : cleanPages(opts.pages);
  if (!pages.length) throw new GuestError("Choose at least one page they can open.");
  if (!validMinutes(opts.minutes)) throw new GuestError("Choose how long the access lasts.");
  let username = (opts.username ?? "").trim().toLowerCase();
  if (username) {
    if (!USERNAME_RE.test(username)) {
      throw new GuestError("Username: 3–30 characters, lowercase letters, numbers, dot, dash or underscore.");
    }
    if (configuredUsers().includes(username)) throw new GuestError("That username already belongs to a member.");
  } else {
    // guest-xxxx: short and easy to type
    username = `guest-${generatePassword(5).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  }
  const password = generatePassword(12);
  try {
    const rows = await query<Guest>(
      `INSERT INTO guest_access (username, label, password_hash, created_by, expires_at, pages)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5::int), $6)
       RETURNING ${COLS}`,
      [username, label, await hashPassword(password), opts.createdBy, opts.minutes, pages],
    );
    statusCache.delete(username);
    return { guest: rows[0], password };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new GuestError("That username is already taken.");
    throw err;
  }
}

/** Revoke now, give more time (also re-opens an ended login), or change the pages they may open. */
export async function updateGuest(
  id: number, action: "revoke" | "extend" | "pages", opts: { minutes?: number; pages?: unknown } = {},
): Promise<Guest | null> {
  const minutes = opts.minutes ?? 60;
  if (action === "pages") {
    const pages = cleanPages(opts.pages);
    if (!pages.length) throw new GuestError("Choose at least one page they can open.");
    const rows = await query<Guest>(`UPDATE guest_access SET pages = $2 WHERE id = $1 RETURNING ${COLS}`, [id, pages]);
    if (rows[0]) statusCache.delete(rows[0].username);
    return rows[0] ?? null;
  }
  const rows =
    action === "revoke"
      ? await query<Guest>(`UPDATE guest_access SET revoked_at = now() WHERE id = $1 RETURNING ${COLS}`, [id])
      : await query<Guest>(
          `UPDATE guest_access
              SET revoked_at = NULL,
                  expires_at = greatest(expires_at, now()) + make_interval(mins => $2::int)
            WHERE id = $1 RETURNING ${COLS}`,
          [id, validMinutes(minutes) ? minutes : 60],
        );
  if (rows[0]) statusCache.delete(rows[0].username);
  return rows[0] ?? null;
}

/** Checks a guest's username and password; returns the session name and end of access. */
export async function guestLogin(
  username: string, password: string,
): Promise<{ user: string; expiresAt: number; pages: GuestPage[] } | null> {
  const name = (username ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(name)) return null;
  const rows = await query<{ password_hash: string; expires_at: Date; active: boolean; pages: string[] }>(
    `SELECT password_hash, expires_at, pages, (revoked_at IS NULL AND expires_at > now()) AS active
       FROM guest_access WHERE username = $1`,
    [name],
  );
  const ok = await verifyPassword(password ?? "", rows[0]?.password_hash);
  if (!ok || !rows[0].active) return null;
  await query(`UPDATE guest_access SET last_login_at = now(), login_count = login_count + 1 WHERE username = $1`, [name]);
  statusCache.delete(name);
  return { user: GUEST_PREFIX + name, expiresAt: new Date(rows[0].expires_at).getTime(), pages: cleanPages(rows[0].pages) };
}

// Small per-instance cache so pages don't query the table on every request.
export interface GuestState { active: boolean; expiresAt: number; label: string; pages: GuestPage[] }
const statusCache = new Map<string, GuestState & { at: number }>();
const CACHE_MS = 20_000;

/** Is this guest session still allowed? (fails closed: unknown or database error = no) */
export async function guestStatus(user: string): Promise<GuestState> {
  const name = guestName(user);
  const hit = statusCache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit, active: hit.active && hit.expiresAt > Date.now() };
  try {
    const rows = await query<{ expires_at: Date; revoked: boolean; label: string; pages: string[] }>(
      `SELECT expires_at, revoked_at IS NOT NULL AS revoked, label, pages FROM guest_access WHERE username = $1`,
      [name],
    );
    const r = rows[0];
    const v = {
      active: Boolean(r && !r.revoked && new Date(r.expires_at).getTime() > Date.now()),
      expiresAt: r ? new Date(r.expires_at).getTime() : 0,
      label: r?.label ?? "",
      pages: cleanPages(r?.pages),
    };
    statusCache.set(name, { ...v, at: Date.now() });
    return v;
  } catch {
    return { active: false, expiresAt: 0, label: "", pages: [] };
  }
}

/** End of a guest's next session: an hour from now, but never past the end of their access. */
export const guestSessionUntil = (expiresAt: number) => Math.min(expiresAt, Date.now() + GUEST_SESSION_MIN * 60_000);

export class GuestError extends Error {}
