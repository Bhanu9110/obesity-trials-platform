import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, authConfigured, checkCredentials, createSession } from "@/lib/auth";
import { FAILURE_WINDOW_MIN, logAccess, tooManyFailures } from "@/lib/access-log";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Login is not configured on the server." }, { status: 503 });
  }
  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = String(body?.username ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Repeated wrong passwords from one network are blocked for a while.
  if (await tooManyFailures(req)) {
    await logAccess("blocked", username, req);
    return NextResponse.json(
      { error: `Too many failed sign-in attempts. Try again in ${FAILURE_WINDOW_MIN} minutes.` },
      { status: 429 },
    );
  }

  const user = await checkCredentials(username, password);
  if (!user) {
    await logAccess("login_failed", username, req);
    await new Promise((r) => setTimeout(r, 600)); // slow down password guessing
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }
  await logAccess("login", user, req);

  const res = NextResponse.json({ ok: true, user });
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(SESSION_COOKIE, await createSession(user), {
    httpOnly: true,
    secure: https,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
