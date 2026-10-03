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
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">This page didn’t load</h1>
      <p className="mt-2 text-sm text-slate-500">
        Usually a brief connection hiccup with the database. Trying again normally works.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
        <a href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Go to Trials
        </a>
      </div>
      {error.digest && <p className="mt-4 text-xs text-slate-400">Error code: {error.digest}</p>}
    </div>
  );
}
