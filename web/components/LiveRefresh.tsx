"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Fired on window when the data changed; pages that fetch their own data (Trials) listen for it. */
export const DATA_UPDATED = "ot:data-updated";

const EVERY_MS = 60_000;   // check once a minute while the page is on screen
const MIN_GAP_MS = 10_000; // and when you come back to the tab, at most every 10 s

/**
 * Keeps every open page current. Asks /api/version for the data fingerprint
 * (lib/data-version.ts) every minute and whenever you return to the tab; when it
 * changed — a sync finished, someone edited or merged a drug, quality was re-checked —
 * the page's numbers reload in place (router.refresh keeps what you typed, your
 * filters and scroll position) and a small note says so.
 */
export default function LiveRefresh() {
  const router = useRouter();
  const known = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const busy = useRef(false);
  const [note, setNote] = useState(false);

  useEffect(() => {
    let stopped = false;
    let hide: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (stopped || busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      lastCheck.current = Date.now();
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (r.status === 401 || r.status === 403) { stopped = true; return; } // signed out / access ended
        if (!r.ok) return;
        const { v } = (await r.json()) as { v?: string };
        if (!v) return;
        if (known.current !== null && known.current !== v) {
          router.refresh();
          window.dispatchEvent(new Event(DATA_UPDATED));
          setNote(true);
          clearTimeout(hide);
          hide = setTimeout(() => setNote(false), 5000);
        }
        known.current = v;
      } catch {
        // offline for a moment: try again next time
      } finally {
        busy.current = false;
      }
    }

    const soon = () => { if (Date.now() - lastCheck.current > MIN_GAP_MS) check(); };
    check();
    const id = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", soon);
    window.addEventListener("focus", soon);
    window.addEventListener("online", soon);
    return () => {
      stopped = true;
      clearInterval(id);
      clearTimeout(hide);
      document.removeEventListener("visibilitychange", soon);
      window.removeEventListener("focus", soon);
      window.removeEventListener("online", soon);
    };
  }, [router]);

  if (!note) return null;
  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-sm text-slate-700 shadow-lg">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Updated with the latest data
    </div>
  );
}
