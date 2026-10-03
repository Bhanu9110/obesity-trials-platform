import type { NextRequest } from "next/server";
import { SESSION_COOKIE, authDisabled, verifySession } from "./auth";

/** The signed-in user (or "local" when login is switched off for local use). */
export async function currentUser(req: NextRequest): Promise<string | null> {
  if (authDisabled()) return "local";
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Admin actions (start a sync, re-queue / dismiss failed records). Everyone who
 * can sign in, unless ADMIN_USERS lists specific usernames (comma-separated).
 */
export function mayAdminister(user: string | null): boolean {
  if (!user) return false;
  const admins = (process.env.ADMIN_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.length === 0 || user === "local" || admins.includes(user.toLowerCase());
}
