import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/access-log";
import { isGuest, isSiteUser } from "@/lib/auth";
import { UserError, changeOwnPassword } from "@/lib/site-users";

export const dynamic = "force-dynamic";

/** Change your own password: { current, next }. Admins and members made on the site (owners: in Vercel). */
export async function POST(req: NextRequest) {
  const me = await activeUser(req);
  if (!me) return NextResponse.json({ error: "login required" }, { status: 401 });
  if (!isSiteUser(me)) {
    return NextResponse.json({ error: "Owner passwords are set in Vercel (AUTH_USERS), not here." }, { status: 400 });
  }
  if (isGuest(me)) {
    return NextResponse.json({ error: "Guest logins can't change their password — ask the person who gave you access." }, { status: 403 });
  }
  try {
    const b = await req.json().catch(() => ({}));
    await changeOwnPassword(me, String(b?.current ?? ""), String(b?.next ?? ""));
    await logAdminAction("password_changed", me, req, "changed own password");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
