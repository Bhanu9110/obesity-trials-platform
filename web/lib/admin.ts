import type { NextRequest } from "next/server";
import { SESSION_COOKIE, authDisabled, isGuest, isSiteAdmin, isSiteUser, ownersInOrder, verifySession } from "./auth";
import { siteUserStatus } from "./site-users";

/** The signed-in user (or "local" when login is switched off for local use). */
export async function currentUser(req: NextRequest): Promise<string | null> {
  if (authDisabled()) return "local";
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

// Who may run the website:
//   super admin — exactly ONE account: the owner named in SUPER_ADMIN (Vercel). Everything an
//                 admin can do, plus creating, changing and removing admins. It can never be
//                 created on the website.
//   admin       — every other owner account (all of them, or only those in ADMIN_USERS), and
//                 admin logins the super admin made on the website. Admin + Audit logs pages;
//                 manage members and guests.
// If SUPER_ADMIN is empty or doesn't name an owner account, the FIRST owner written in
// AUTH_USERS is the super admin — so there is always one, and never more than one.
export type AdminLevel = "super" | "admin";

/** Where the super admin comes from: the SUPER_ADMIN setting, or the first owner as a fallback. */
export type SuperAdminSource = "setting" | "first_owner" | "invalid_setting" | "none";

export function superAdminInfo(): { name: string | null; source: SuperAdminSource; setting: string | null } {
  const owners = ownersInOrder();
  // One name only: "ObeyBhanu" (a comma-separated list keeps just the first).
  const setting = (process.env.SUPER_ADMIN ?? "").split(",")[0].trim().toLowerCase() || null;
  if (setting && owners.includes(setting)) return { name: setting, source: "setting", setting };
  if (!owners.length) return { name: null, source: "none", setting };
  return { name: owners[0], source: setting ? "invalid_setting" : "first_owner", setting };
}

/** The one super admin's username (lower case), or null when there are no owner accounts. */
export function superAdminName(): string | null {
  return superAdminInfo().name;
}

/** Owner accounts allowed on the Admin page (ADMIN_USERS, or all owners when it is empty). */
function ownerMayAdminister(user: string): boolean {
  const admins = (process.env.ADMIN_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sup = superAdminName();
  return admins.length === 0 || admins.includes(user.toLowerCase()) || sup === user.toLowerCase();
}

/** Admin level of an owner account (AUTH_USERS) — no database needed. */
export function ownerLevel(user: string): AdminLevel | null {
  if (user === "local") return "super";
  if (isSiteUser(user) || !ownerMayAdminister(user)) return null;
  return superAdminName() === user.toLowerCase() ? "super" : "admin";
}

/** Admin level of any signed-in user; site admins are checked against the database. */
export async function adminLevel(user: string | null): Promise<AdminLevel | null> {
  if (!user) return null;
  if (isSiteAdmin(user)) {
    const s = await siteUserStatus(user);
    return s.active && s.role === "admin" ? "admin" : null;
  }
  if (isSiteUser(user)) return null; // members and guests
  return ownerLevel(user);
}

/** Admin and Audit logs pages and their actions: admins and the super admin. */
export async function mayAdminister(user: string | null): Promise<boolean> {
  return (await adminLevel(user)) !== null;
}

/** Creating, changing and removing admins: the super admin only. */
export async function isSuperAdmin(user: string | null): Promise<boolean> {
  return (await adminLevel(user)) === "super";
}

/** Role shown in the site (sidebar, profile, audit log). */
export type ShownRole = "super_admin" | "owner" | "admin" | "member" | "guest";
export async function shownRole(user: string): Promise<ShownRole> {
  if (isGuest(user)) return "guest";
  if (isSiteAdmin(user)) return "admin";
  if (isSiteUser(user)) return "member";
  const lvl = ownerLevel(user);
  return lvl === "super" ? "super_admin" : lvl === "admin" ? "admin" : "owner";
}
export const ROLE_NAMES: Record<ShownRole, string> = {
  super_admin: "Super admin", owner: "Owner", admin: "Admin", member: "Member", guest: "Guest",
};

/**
 * Downloading data (Excel, PDF, CSV, Word): the super admin, owners and admins always; members and
 * guests only when an admin ticked "Can download data" for their login (site_users.can_export).
 */
export async function mayExport(user: string | null): Promise<boolean> {
  if (!user) return false;
  if (user === "local" || !isSiteUser(user)) return true; // owner accounts (AUTH_USERS), local use
  const s = await siteUserStatus(user);
  return s.active && s.canExport;
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

