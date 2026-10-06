import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { SESSION_COOKIE, authDisabled, isGuest, isSiteUser, plainName, verifySession } from "@/lib/auth";
import { siteUserStatus } from "@/lib/site-users";
import { firstPagePath, type GuestPage } from "@/lib/guest-pages";
import { displayTimeZone } from "@/lib/queries";
import ActivityTracker from "@/components/ActivityTracker";
import AppShell, { type ShellNavItem } from "@/components/shell/AppShell";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Obesity Trials Intelligence",
  description:
    "Obesity drug trials from ClinicalTrials.gov: phase, sponsor, indication, intervention and location, with a product page per drug.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const disabled = authDisabled();
  const user = disabled ? null : await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  // Logins made on the Admin page (members and guests) are checked against the database.
  const site = user && isSiteUser(user) ? await siteUserStatus(user) : null;
  const guest = user && isGuest(user) && site?.active ? site : null;
  const ended = Boolean(site && !site.active);
  // Owners see everything; site members every page but Admin; guests only their pages.
  const can = (page: GuestPage) => !guest || guest.pages.includes(page);
  const showAdmin = !site;
  const showNav = (disabled || Boolean(user)) && !ended;
  const until = site?.active && site.expiresAt
    ? new Date(site.expiresAt).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: displayTimeZone(),
      })
    : null;
  const nav: ShellNavItem[] = [
    ...(can("trials") ? [{ href: "/", label: "Overview", icon: "overview", section: "Intelligence" } as const,
                         { href: "/trials", label: "Trials explorer", icon: "trials", section: "Intelligence" } as const] : []),
    ...(can("drugs") ? [{ href: "/drugs", label: "Drugs", icon: "drugs", section: "Intelligence" } as const] : []),
    ...(can("changes") ? [{ href: "/changes", label: "Registry changes", icon: "changes", section: "Intelligence" } as const] : []),
    ...(can("quality") ? [{ href: "/quality", label: "Data quality", icon: "quality", section: "Workspace" } as const] : []),
    ...(showAdmin ? [{ href: "/admin", label: "Admin", icon: "admin", section: "Workspace" } as const] : []),
  ];
  const shellUser = user
    ? {
        name: site?.label?.trim() || plainName(user),
        username: plainName(user),
        badge: until,
        role: guest ? "guest" as const : site ? "member" as const : "owner" as const,
      }
    : null;
  // Apply the saved theme before the first paint (light unless the viewer chose dark).
  const themeScript = `try{var t=localStorage.getItem("otd-theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
  const fonts = (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap"
      />
    </>
  );

  const onLoginPage = (await headers()).get("x-otd-login-page") === "1";
  const displayName = site?.label?.trim() || (user ? plainName(user) : "");

  // Signed in (or login switched off locally): the full app frame.
  if (showNav && !onLoginPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>{fonts}</head>
        <body>
          {user && <ActivityTracker endsAt={site?.active && site.expiresAt ? site.expiresAt : undefined} />}
          <AppShell nav={nav} user={shellUser} homeHref={guest ? firstPagePath(guest.pages) : "/"} canTrials={can("trials")}>
            {children}
          </AppShell>
        </body>
      </html>
    );
  }

  // Sign-in page, or a login whose access has ended: a minimal frame.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>{fonts}</head>
      <body>
        <header className="mx-auto flex h-16 max-w-6xl items-center px-4">
          <span className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <span className="leading-tight">
              <span className="block font-display text-[14px] font-semibold tracking-tight text-slate-950">Obesity Trials</span>
              <span className="block font-display text-[12px] font-semibold tracking-[0.2em] text-gradient">INTELLIGENCE</span>
            </span>
          </span>
        </header>
        <main className="mx-auto max-w-6xl animate-fade-up px-4 py-8">
          {onLoginPage && user && !ended && (
            <div className="mx-auto mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
              <span>
                You&apos;re signed in as <b className="text-slate-950">{displayName}</b>
                {displayName !== plainName(user) && <span className="text-slate-500"> ({plainName(user)})</span>}.
                Sign in below to switch to another account.
              </span>
              <a href="/" className="rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm text-white">Continue as {plainName(user)} →</a>
            </div>
          )}
          {ended ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <div className="mx-auto mb-4 w-fit"><LogoMark size={44} /></div>
              <h1 className="text-xl font-semibold text-slate-900">Your access has ended</h1>
              <p className="mt-2 text-sm text-slate-500">
                Thanks for taking a look. To continue, ask the person who gave you access.
              </p>
              <form action="/api/auth/logout" method="post" className="mt-6">
                <button type="submit" className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            children
          )}
        </main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
          Trial data from ClinicalTrials.gov (v2 API), synced daily.
        </footer>
      </body>
    </html>
  );
}
