"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** "This is a duplicate of …" — merge a drug into another (typos, code names, brand names). */
export default function MergeProduct({
  slug,
  name,
  options,
}: {
  slug: string;
  name: string;
  options: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = options.filter((o) => o.slug !== slug);
  const match = choices.find((o) => o.name.toLowerCase() === target.trim().toLowerCase());

  async function merge() {
    if (!match) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(slug)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into: match.slug }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push(`/drugs/${encodeURIComponent(body.into)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
        Duplicate of another drug? Merge it…
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="mb-2 text-slate-700">
        Merge <strong>{name}</strong> into another drug. Its trials move to that drug, blank info fields
        are filled from this one, and future syncs keep it merged.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          list="merge-targets"
          placeholder="Type the drug to merge into…"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 outline-none focus:border-brand-500"
        />
        <datalist id="merge-targets">
          {choices.map((o) => (
            <option key={o.slug} value={o.name} />
          ))}
        </datalist>
        <button
          onClick={merge}
          disabled={!match || busy}
          className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Merging…" : "Merge"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
          Cancel
        </button>
      </div>
      {target && !match && <p className="mt-1 text-xs text-slate-500">Pick a drug from the list.</p>}
      {error && <p className="mt-2 text-rose-700">{error}</p>}
    </div>
  );
}
