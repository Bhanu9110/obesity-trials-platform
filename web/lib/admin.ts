import type { NextRequest } from "next/server";
import { SESSION_COOKIE, authDisabled, isGuest, isSiteUser, verifySession } from "./auth";
import { siteUserStatus } from "./site-users";

/** The signed-in user (or "local" when login is switched off for local use). */
export async function currentUser(req: NextRequest): Promise<string | null> {
  if (authDisabled()) return "local";
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Admin page and its actions: owner accounts from AUTH_USERS — all of them, or
 * only those listed in ADMIN_USERS (comma-separated). Never a site member or guest.
 */
export function mayAdminister(user: string | null): boolean {
  if (!user || isSiteUser(user)) return false; // only owners (AUTH_USERS) — never members or guests made on the site
  const admins = (process.env.ADMIN_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.length === 0 || user === "local" || admins.includes(user.toLowerCase());
}

/** Editing drug info and merging drugs: any signed-in member, never a guest. */
export function mayEdit(user: string | null): boolean {
  return Boolean(user) && !isGuest(user);
}

/**
 * The signed-in user, but null for a login made on the Admin page that has since
 * been deleted, revoked or has ended (their cookie may not have run out yet).
 */
export async function activeUser(req: NextRequest): Promise<string | null> {
  const user = await currentUser(req);
  if (user && isSiteUser(user) && !(await siteUserStatus(user)).active) return null;
  return user;
}
