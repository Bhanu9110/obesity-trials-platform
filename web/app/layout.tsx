import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { SESSION_COOKIE, authDisabled, guestName, isGuest, verifySession } from "@/lib/auth";
import { guestStatus } from "@/lib/guests";
import { displayTimeZone } from "@/lib/queries";
import ActivityTracker from "@/components/ActivityTracker";

export const metadata: Metadata = {
  title: "Obesity Trials Intelligence",
  description:
    "Obesity drug trials from ClinicalTrials.gov: phase, sponsor, indication, intervention and location, with a product page per drug.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const disabled = authDisabled();
  const user = disabled ? null : await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const guest = user && isGuest(user) ? await guestStatus(user) : null;
  const guestEnded = Boolean(guest && !guest.active);
  const showNav = (disabled || Boolean(user)) && !guestEnded;
  const guestUntil = guest?.active
    ? new Date(guest.expiresAt).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: displayTimeZone(),
      })
    : null;
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                OT
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900">
                  Obesity Trials Intelligence
                </div>
                <div className="text-[11px] text-slate-500">
                  Drug database · ClinicalTrials.gov
                </div>
              </div>
            </Link>
            {showNav && (
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              >
                Trials
              </Link>
              <Link
                href="/drugs"
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              >
                Drugs
              </Link>
              <Link
                href="/changes"
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              >
                Changes
              </Link>
              {!guest && (
                <>
                  <Link
                    href="/quality"
                    className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    Data quality
                  </Link>
                  <Link
                    href="/admin"
                    className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    Admin
                  </Link>
                </>
              )}
              {user && (
                <form action="/api/auth/logout" method="post" className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-3">
                  {guest ? (
                    <span className="hidden text-xs text-slate-500 sm:inline" title="Temporary view-only access">
                      {guestName(user)}
                      <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                        Guest · until {guestUntil}
                      </span>
                    </span>
                  ) : (
                    <span className="hidden text-xs text-slate-500 sm:inline">{user}</span>
                  )}
                  <button type="submit" className="rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100">
                    Sign out
                  </button>
                </form>
              )}
            </nav>
            )}
          </div>
        </header>
        {user && !guestEnded && <ActivityTracker endsAt={guest?.active ? guest.expiresAt : undefined} />}
        <main className="mx-auto max-w-7xl px-4 py-6">
          {guestEnded ? (
            <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
              <h1 className="text-lg font-semibold text-slate-900">Your guest access has ended</h1>
              <p className="mt-2 text-sm text-slate-500">
                Thanks for taking a look. To continue, ask the person who invited you for more time.
              </p>
              <form action="/api/auth/logout" method="post" className="mt-4">
                <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            children
          )}
        </main>
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-xs text-slate-400">
          Trial data from ClinicalTrials.gov (v2 API), updated daily. Product information is curated manually.
        </footer>
      </body>
    </html>
  );
}
