"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Tells the server which page a signed-in member opened (for the Admin access log). */
export default function ActivityTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/login")) return;
    const body = JSON.stringify({ path: pathname });
    // Fire and forget: never delays or breaks the page.
    fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
