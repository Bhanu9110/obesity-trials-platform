"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProductSummary } from "@/lib/types";
import { highestPhase } from "@/lib/format";

const PAGE = 50;

export default function DrugsTable({ products }: { products: ProductSummary[] }) {
  const [q, setQ] = useState("");
  const [info, setInfo] = useState<"" | "filled" | "blank">("");
  const [page, setPage] = useState(1);
  // Drugs that only appear in non-primary trials (comorbidity, weight-related, not obesity)
  // are hidden unless asked for.
  const [includeOther, setIncludeOther] = useState(false);
  const otherOnly = useMemo(() => products.filter((p) => p.trials === 0).length, [products]);
  const visible = useMemo(() => (includeOther ? products : products.filter((p) => p.trials > 0)), [products, includeOther]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible.filter((p) => {
      if (info === "filled" && !p.has_info) return false;
      if (info === "blank" && p.has_info) return false;
      if (!needle) return true;
      return [p.name, p.sponsor, p.drug_class, p.modality].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [visible, q, info]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const filled = visible.filter((p) => p.has_info).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Find a drug…"
          className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={info}
          onChange={(e) => {
            setInfo(e.target.value as typeof info);
            setPage(1);
          }}
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
        >
          <option value="">All drugs ({visible.length.toLocaleString()})</option>
          <option value="filled">Edited by hand ({filled.toLocaleString()})</option>
          <option value="blank">Auto-filled only ({(visible.length - filled).toLocaleString()})</option>
        </select>
        {otherOnly > 0 && (
          <label className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600"
                 title="Drugs whose trials are all comorbidity / weight-related / not obesity">
            <input
              type="checkbox"
              checked={includeOther}
              onChange={(e) => {
                setIncludeOther(e.target.checked);
                setPage(1);
              }}
            />
            + {otherOnly.toLocaleString()} only in non-primary trials
          </label>
        )}
      </div>

      <div className="text-sm text-slate-500">{rows.length.toLocaleString()} drugs</div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Drug</th>
              <th className="px-4 py-3 text-right font-semibold" title="Primary-obesity trials (+ other stored trials)">Trials</th>
              <th className="px-4 py-3 font-semibold">Most advanced trial</th>
              <th className="px-4 py-3 font-semibold">Modality</th>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold">Approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No drugs match.</td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.slug} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/drugs/${encodeURIComponent(p.slug)}`} className="font-medium text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {p.trials}
                    {p.all_trials > p.trials && (
                      <span className="ml-1 text-xs text-slate-400" title="Other stored trials (comorbidity / weight-related / not obesity)">
                        +{p.all_trials - p.trials}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{highestPhase(p.trial_phases)}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.modality || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.drug_class || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.approved || <span className="text-slate-300">—</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">
            Prev
          </button>
          <span className="text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
