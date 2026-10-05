import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/admin";
import { logAccess } from "@/lib/access-log";
import { SESSION_COOKIE, createSession, isGuest, isSiteUser } from "@/lib/auth";
import { sessionUntil, siteUserStatus } from "@/lib/site-users";
import { firstPagePath, guestMayOpen } from "@/lib/guest-pages";

export const dynamic = "force-dynamic";

/**
 * Records one page view of the signed-in user (sent by the site on every page
 * change). For logins made on the Admin page it is also the check-in: one that
 * was deleted, revoked or has ended is signed out here; an active one gets their
 * session renewed (with their current pages, for guests).
 */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "login required" }, { status: 401 });
  let path = "";
  try {
    path = String((await req.json())?.path ?? "");
  } catch { /* ignore */ }
  if (!/^\/[\w\-./%?=&]*$/.test(path)) path = "/";

  if (isSiteUser(user)) {
    const st = await siteUserStatus(user);
    if (!st.active || !st.role) {
      const res = NextResponse.json({ error: "access has ended", ended: true }, { status: 401 });
      res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }
    const guest = isGuest(user);
    // Pages changed on the Admin page while they were here: move them on.
    const allowed = !guest || guestMayOpen(st.pages, path.split("?")[0]);
    if (allowed) await logAccess("page", user, req, path);
    const until = sessionUntil(st.role, st.expiresAt);
    const res = allowed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ redirect: firstPagePath(st.pages) }, { status: 403 });
    const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    res.cookies.set(SESSION_COOKIE, await createSession(user, until, guest ? st.pages : undefined), {
      httpOnly: true, secure: https, sameSite: "lax", path: "/",
      maxAge: Math.max(60, Math.round((until - Date.now()) / 1000)),
    });
    return res;
  }

  if (user !== "local") await logAccess("page", user, req, path);
  return new NextResponse(null, { status: 204 });
}
