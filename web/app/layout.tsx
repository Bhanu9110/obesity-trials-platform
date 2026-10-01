import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Obesity Trials Intelligence",
  description:
    "Obesity drug trials from ClinicalTrials.gov: phase, sponsor, indication, intervention and location, with a product page per drug.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
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
            <nav className="flex items-center gap-1 text-sm">
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
                href="/admin"
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              >
                Admin
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-xs text-slate-400">
          Trial data from ClinicalTrials.gov (v2 API), updated daily. Product information is curated manually.
        </footer>
      </body>
    </html>
  );
}
