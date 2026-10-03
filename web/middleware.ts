import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authConfigured, authDisabled, verifySession } from "@/lib/auth";

// Every page and API requires login, except the login page itself.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function middleware(req: NextRequest) {
  if (authDisabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  // Already signed in? The login page sends you on to where you were going.
  if (pathname === "/login" && authConfigured()) {
    if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
      const raw = req.nextUrl.searchParams.get("next") || "/";
      const dest = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/";
      return NextResponse.redirect(new URL(dest, req.url));
    }
  }
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  // Fail closed: a hosted site with no login configured must not be open.
  if (!authConfigured()) {
    return new NextResponse(
      "Login is not configured. Set AUTH_USERS and AUTH_SECRET (or AUTH_DISABLED=true for local use).",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "login required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
