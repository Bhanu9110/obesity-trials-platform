// Users & access: logins managed on the Admin page (server-only, uses the database).
//   member: every page except Admin, may edit drug profiles; optional end date
//   guest : only the chosen pages, view-only; always ends
// Owners (AUTH_USERS in Vercel) are not stored here.
import { query } from "./db";
import {
  GUEST_PREFIX, GUEST_SESSION_MIN, MEMBER_PREFIX, MEMBER_SESSION_MIN, configuredUsers, decryptText, encryptText,
  generatePassword, hashPassword, isGuest, plainName, verifyPassword,
} from "./auth";
import { DEFAULT_GUEST_PAGES, GUEST_PAGES, cleanPages, type GuestPage } from "./guest-pages";

export type Role = "member" | "guest";
export type UserStatus = "active" | "expired" | "revoked";

export interface SiteUser {
  id: number;
  username: string;
  label: string;
  role: Role;
  pages: GuestPage[];            // guests; members can open everything except Admin
  created_by: string | null;
  created_at: string;
  expires_at: string | null;     // null = no end date (members only)
  revoked_at: string | null;
  last_login_at: string | null;
  login_count: number;
  has_password_copy: boolean;
  status: UserStatus;
}

/** How long access lasts, in minutes (null = no end date, members only). */
export const ACCESS_MINUTES = [10, 15, 30, 60, 120, 240, 480, 1440, 4320, 10080, 20160, 43200] as const;
const validMinutes = (m: unknown): m is number => (ACCESS_MINUTES as readonly number[]).includes(Number(m));
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const ALL_PAGES = GUEST_PAGES.map((p) => p.key) as GuestPage[];

const COLS = `id::int AS id, username, label, role, pages, created_by, created_at, expires_at, revoked_at,
  last_login_at, login_count, (password_enc IS NOT NULL) AS has_password_copy,
  CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
       WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired' ELSE 'active' END AS status`;

export class UserError extends Error {}

export async function listUsers(): Promise<SiteUser[]> {
  return query<SiteUser>(
    `SELECT ${COLS} FROM site_users
      ORDER BY (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) DESC,
               role DESC, created_at DESC
      LIMIT 500`,
  );
}

function checkPassword(pw: string): string {
  const p = pw.trim();
  if (p.length < 8 || p.length > 64) throw new UserError("Password: 8–64 characters.");
  if (/[\s,]/.test(p)) throw new UserError("Password can't contain spaces or commas.");
  return p;
}

/** Creates a login; returns the password (made up unless one was given). */
export async function createUser(opts: {
  label: string; username?: string; password?: string; role: Role; minutes: number | null; pages?: unknown; createdBy: string | null;
}) {
  const label = opts.label.trim().slice(0, 120);
  if (!label) throw new UserError("Add a name or who the login is for.");
  if (opts.role !== "member" && opts.role !== "guest") throw new UserError("Choose Member or Guest.");
  if (opts.minutes === null ? opts.role === "guest" : !validMinutes(opts.minutes)) {
    throw new UserError(opts.role === "guest" ? "Choose how long the guest's access lasts." : "Choose how long the access lasts.");
  }
  const pages = opts.role === "member" ? ALL_PAGES : opts.pages === undefined ? DEFAULT_GUEST_PAGES : cleanPages(opts.pages);
  if (!pages.length) throw new UserError("Choose at least one page they can open.");

  let username = (opts.username ?? "").trim().toLowerCase();
  if (username) {
    if (!USERNAME_RE.test(username)) throw new UserError("Username: 3–30 characters — lowercase letters, numbers, dot, dash or underscore.");
    if (configuredUsers().includes(username)) throw new UserError("That username is an owner account (set in Vercel).");
  } else {
    username = `${opts.role === "guest" ? "guest" : "user"}-${generatePassword(5).toLowerCase()}`;
  }
  const password = opts.password ? checkPassword(opts.password) : generatePassword(12);
  try {
    const rows = await query<SiteUser>(
      `INSERT INTO site_users (username, label, role, pages, password_hash, password_enc, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(mins => $8::int) END)
       RETURNING ${COLS}`,
      [username, label, opts.role, pages, await hashPassword(password), await encryptText(password), opts.createdBy, opts.minutes],
    );
    forget(username);
    return { user: rows[0], password };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new UserError("That username is already taken.");
    throw err;
  }
}

export type UserAction =
  | { action: "revoke" }
  | { action: "extend"; minutes: number }
  | { action: "set_end"; until: string }
  | { action: "no_end" }
  | { action: "pages"; pages: unknown }
  | { action: "role"; role: Role }
  | { action: "label"; label: string }
  | { action: "password"; password?: string };

/** Change one login. "password" returns the new password. */
export async function updateUser(id: number, a: UserAction): Promise<{ user: SiteUser | null; password?: string }> {
  let rows: SiteUser[];
  let password: string | undefined;
  switch (a.action) {
    case "revoke":
      // Ending access throws away the time that was left, so giving time later starts from now.
      rows = await query<SiteUser>(
        `UPDATE site_users SET revoked_at = now(), expires_at = least(expires_at, now()) WHERE id = $1 RETURNING ${COLS}`, [id],
      );
      break;
    case "extend":
      // Active: added on top of the time left. Ended (revoked or run out): counted from now.
      if (!validMinutes(a.minutes)) throw new UserError("Choose how much time to add.");
      rows = await query<SiteUser>(
        `UPDATE site_users
            SET expires_at = CASE WHEN revoked_at IS NOT NULL OR expires_at IS NULL OR expires_at <= now() THEN now()
                                  ELSE expires_at END + make_interval(mins => $2::int),
                revoked_at = NULL
          WHERE id = $1 RETURNING ${COLS}`,
        [id, a.minutes],
      );
      break;
    case "set_end": {
      // An exact end time, e.g. "until Friday 6 pm".
      const t = Date.parse(a.until);
      if (isNaN(t)) throw new UserError("Choose a date and time.");
      if (t <= Date.now() + 60_000) throw new UserError("The end time must be in the future.");
      if (t > Date.now() + 366 * 86_400_000) throw new UserError("Choose an end time within a year.");
      rows = await query<SiteUser>(
        `UPDATE site_users SET expires_at = $2, revoked_at = NULL WHERE id = $1 RETURNING ${COLS}`, [id, new Date(t)],
      );
      break;
    }
    case "no_end":
      rows = await query<SiteUser>(
        `UPDATE site_users SET expires_at = NULL, revoked_at = NULL WHERE id = $1 AND role = 'member' RETURNING ${COLS}`, [id],
      );
      if (!rows[0]) throw new UserError("Only members can have no end date — guests always end.");
      break;
    case "pages": {
      const pages = cleanPages(a.pages);
      if (!pages.length) throw new UserError("Choose at least one page they can open.");
      rows = await query<SiteUser>(`UPDATE site_users SET pages = $2 WHERE id = $1 RETURNING ${COLS}`, [id, pages]);
      break;
    }
    case "role":
      if (a.role !== "member" && a.role !== "guest") throw new UserError("Choose Member or Guest.");
      // A guest must always end: one becoming a guest with no end date gets 7 days.
      rows = await query<SiteUser>(
        `UPDATE site_users SET role = $2,
                pages = CASE WHEN $2 = 'member' THEN $3::text[] ELSE pages END,
                expires_at = CASE WHEN $2 = 'guest' AND expires_at IS NULL THEN now() + interval '7 days' ELSE expires_at END
          WHERE id = $1 RETURNING ${COLS}`,
        [id, a.role, ALL_PAGES],
      );
      break;
    case "label": {
      const label = a.label.trim().slice(0, 120);
      if (!label) throw new UserError("Add a name or who the login is for.");
      rows = await query<SiteUser>(`UPDATE site_users SET label = $2 WHERE id = $1 RETURNING ${COLS}`, [id, label]);
      break;
    }
    case "password":
      password = a.password ? checkPassword(a.password) : generatePassword(12);
      rows = await query<SiteUser>(
        `UPDATE site_users SET password_hash = $2, password_enc = $3 WHERE id = $1 RETURNING ${COLS}`,
        [id, await hashPassword(password), await encryptText(password)],
      );
      break;
    default:
      throw new UserError("Unknown action.");
  }
  if (rows[0]) forget(rows[0].username);
  return { user: rows[0] ?? null, password };
}

export async function deleteUser(id: number): Promise<boolean> {
  const rows = await query<{ username: string }>(`DELETE FROM site_users WHERE id = $1 RETURNING username`, [id]);
  if (rows[0]) forget(rows[0].username);
  return Boolean(rows[0]);
}

/** The kept copy of a password, for the admin (null if none or unreadable). */
export async function revealPassword(id: number): Promise<{ username: string; password: string | null } | null> {
  const rows = await query<{ username: string; password_enc: string | null }>(
    `SELECT username, password_enc FROM site_users WHERE id = $1`, [id],
  );
  if (!rows[0]) return null;
  return { username: rows[0].username, password: await decryptText(rows[0].password_enc) };
}

/** Checks a site user's username and password. */
export async function siteLogin(username: string, password: string): Promise<
  { user: string; role: Role; expiresAt: number | null; pages: GuestPage[] } | null
> {
  const name = (username ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(name)) return null;
  const rows = await query<{ password_hash: string; expires_at: Date | null; active: boolean; pages: string[]; role: Role }>(
    `SELECT password_hash, expires_at, pages, role,
            (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active
       FROM site_users WHERE username = $1`,
    [name],
  );
  const ok = await verifyPassword(password ?? "", rows[0]?.password_hash);
  if (!ok || !rows[0].active) return null;
  await query(`UPDATE site_users SET last_login_at = now(), login_count = login_count + 1 WHERE username = $1`, [name]);
  forget(name);
  const r = rows[0];
  return {
    user: (r.role === "guest" ? GUEST_PREFIX : MEMBER_PREFIX) + name,
    role: r.role,
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    pages: r.role === "guest" ? cleanPages(r.pages) : ALL_PAGES,
  };
}

// Small per-instance cache so pages don't query the table on every request.
export interface UserState { active: boolean; role: Role | null; expiresAt: number | null; label: string; pages: GuestPage[] }
const cache = new Map<string, UserState & { at: number }>();
const CACHE_MS = 20_000;
function forget(name: string) { cache.delete(name); }

/**
 * Is this site-user session still allowed? Also false when the login was deleted
 * or switched between member and guest (they sign in again). Fails closed.
 */
export async function siteUserStatus(user: string): Promise<UserState> {
  const name = plainName(user);
  const wantRole: Role = isGuest(user) ? "guest" : "member";
  let state: UserState;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    state = hit;
  } else {
    try {
      const rows = await query<{ expires_at: Date | null; revoked: boolean; label: string; pages: string[]; role: Role }>(
        `SELECT expires_at, revoked_at IS NOT NULL AS revoked, label, pages, role FROM site_users WHERE username = $1`,
        [name],
      );
      const r = rows[0];
      state = {
        active: Boolean(r && !r.revoked),
        role: r?.role ?? null,
        expiresAt: r?.expires_at ? new Date(r.expires_at).getTime() : null,
        label: r?.label ?? "",
        pages: r ? (r.role === "guest" ? cleanPages(r.pages) : ALL_PAGES) : [],
      };
      cache.set(name, { ...state, at: Date.now() });
    } catch {
      return { active: false, role: null, expiresAt: null, label: "", pages: [] };
    }
  }
  const notExpired = state.expiresAt === null || state.expiresAt > Date.now();
  return { ...state, active: state.active && notExpired && state.role === wantRole };
}

/** End of the next session: renewed while they use the site, never past their end date. */
export function sessionUntil(role: Role, expiresAt: number | null): number {
  const len = (role === "guest" ? GUEST_SESSION_MIN : MEMBER_SESSION_MIN) * 60_000;
  return Math.min(expiresAt ?? Infinity, Date.now() + len);
}
