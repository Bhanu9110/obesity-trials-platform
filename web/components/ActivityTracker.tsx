"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Tells the server which page a signed-in member opened (for the Admin access log). */
export default function ActivityTracker({ endsAt }: { endsAt?: number }) {
  const pathname = usePathname();

  // Guests: sign out the moment their access time is over, even without a click.
  useEffect(() => {
    if (!endsAt) return;
    const end = () => { window.location.href = `/login?ended=1`; };
    const ms = endsAt - Date.now();
    if (ms <= 0) { end(); return; }
    const id = setTimeout(end, Math.min(ms + 1000, 2_147_000_000));
    return () => clearTimeout(id);
  }, [endsAt]);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/login")) return;
    const body = JSON.stringify({ path: pathname });
    // Fire and forget: never delays or breaks the page.
    fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .then((r) => {
        // Signed out (guest access ended or revoked, or the session expired): back to sign-in.
        if (r.status === 401) window.location.href = `/login?ended=1&next=${encodeURIComponent(pathname)}`;
      })
      .catch(() => {});
  }, [pathname]);
  return null;
}
