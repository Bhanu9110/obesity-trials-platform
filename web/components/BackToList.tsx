"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lastListUrl } from "@/lib/urlState";

/** "← All drugs" / "← All trials": back to the list with the filters it had (search, stage, phase …). */
export default function BackToList({ path, label }: { path: "/drugs" | "/trials"; label: string }) {
  const [href, setHref] = useState<string>(path);
  useEffect(() => { setHref(lastListUrl(path)); }, [path]);
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-brand-600">
      ← {label}{href !== path && <span className="text-xs text-slate-400">(with your filters)</span>}
    </Link>
  );
}
