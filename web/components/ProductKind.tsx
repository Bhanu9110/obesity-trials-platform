"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "drug" | "supplement" | "not_drug";
const LABEL: Record<Kind, string> = {
  drug: "A drug (listed)",
  supplement: "A supplement / natural product (not listed)",
  not_drug: "Not a drug — diet, procedure, test… (not listed)",
};
const SOURCE: Record<string, string> = {
  list: "the reviewed clean-up list",
  rule: "a name rule",
  manual: "a choice made on this page",
};

/**
 * Whether this entry counts as a drug. Entries that are not (diets, procedures, tests, supplements)
 * stay in the database but are left out of the drug list, dashboard counts, search and the auto-fill.
 */
export default function ProductKind({ slug, kind, source, note, readOnly }: {
  slug: string; kind: "supplement" | "not_drug" | null; source: string | null; note: string | null; readOnly?: boolean;
}) {
  const router = useRouter();
  const current: Kind = kind ?? "drug";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: Kind) {
    if (next === current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(slug)}/kind`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hidden = current !== "drug";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm ${
      hidden ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600"}`}>
      <span>
        {hidden
          ? <>Not in the drug list: <b>{current === "supplement" ? "supplement / natural product" : "not a drug"}</b></>
          : <>Counted as a drug</>}
        {source && (
          <span className="text-xs opacity-80"> — by {SOURCE[source] ?? source}{note && source !== "manual" ? ` (${note})` : ""}</span>
        )}
      </span>
      {!readOnly && (
        <label className="ml-auto flex items-center gap-2 text-xs">
          This is
          <select value={current} disabled={busy} onChange={(e) => save(e.target.value as Kind)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">
            {(Object.keys(LABEL) as Kind[]).map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
          </select>
        </label>
      )}
      {error && <span className="w-full text-xs text-rose-600">{error}</span>}
    </div>
  );
}
