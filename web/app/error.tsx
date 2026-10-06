"use client";

import { useEffect } from "react";

/**
 * Shown instead of Next.js's bare "Application error" page when a page fails to
 * load (most often a brief database hiccup). "Try again" re-runs the page.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      </div>
      <h1 className="font-display text-xl font-semibold text-slate-950">This page didn’t load</h1>
      <p className="mt-2 text-sm text-slate-500">
        Usually a brief connection hiccup with the database. Trying again normally works.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
        <a href="/" className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:text-slate-950">
          Go to Overview
        </a>
      </div>
      {error.digest && <p className="mt-4 text-xs text-slate-400">Error code: {error.digest}</p>}
    </div>
  );
}
