import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authConfigured, authDisabled, isGuest, isSiteMember, readSession } from "@/lib/auth";
import { DEFAULT_GUEST_PAGES, firstPagePath, guestMayOpen, requiredPage } from "@/lib/guest-pages";

// Every page and API requires login, except the login page itself.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function middleware(req: NextRequest) {
  if (authDisabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  // The sign-in page always opens (even when signed in, so you can switch account);
  // the layout is told so it shows the plain sign-in frame with "signed in as …".
  if (pathname === "/login") {
    const headers = new Headers(req.headers);
    headers.set("x-otd-login-page", "1");
    return NextResponse.next({ request: { headers } });
  }
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  // Fail closed: a hosted site with no login configured must not be open.
  if (!authConfigured()) {
    return new NextResponse(
      "Login is not configured. Set AUTH_USERS and AUTH_SECRET (or AUTH_DISABLED=true for local use).",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const user = session?.user ?? null;
  if (user && isGuest(user)) {
    // Guests: only the pages chosen for them, read-only, never the Admin page.
    const pages = session?.pages?.length ? session.pages : DEFAULT_GUEST_PAGES;
    const write = !["GET", "HEAD", "OPTIONS"].includes(req.method) && !["/api/activity", "/api/auth/logout"].includes(pathname);
    if (write || !guestMayOpen(pages, pathname)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Your guest access doesn't include this." }, { status: 403 });
      }
      return NextResponse.redirect(new URL(firstPagePath(pages), req.url));
    }
    return NextResponse.next();
  }
  if (user && isSiteMember(user) && requiredPage(pathname) === "never") {
    // Members made on the Admin page: every page except Admin.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Only owners can open the Admin page." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", req.url));
  }
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
