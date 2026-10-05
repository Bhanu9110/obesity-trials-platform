"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DrugProfile, ProductSummary, ProfileValue } from "@/lib/types";
import { highestPhase } from "@/lib/format";
import { drugProfile } from "@/lib/drug-profile";

const PAGE = 50;

type Row = { p: ProductSummary; prof: DrugProfile };

const COLUMNS: { key: keyof DrugProfile | "trials" | "name"; label: string; width: string }[] = [
  { key: "name", label: "Drug", width: "w-[150px] min-w-[150px]" },
  { key: "aliases", label: "Alias", width: "min-w-[105px]" },
  { key: "brands", label: "Brand name", width: "min-w-[105px]" },
  { key: "candidate", label: "Candidate", width: "min-w-[105px]" },
  { key: "trials", label: "Trials", width: "min-w-[70px]" },
  { key: "parent", label: "Similar / parent drug", width: "min-w-[115px]" },
  { key: "company", label: "Company", width: "min-w-[120px]" },
  { key: "therapyClass", label: "Therapy class / subclass", width: "min-w-[180px]" },
  { key: "indication", label: "Indication", width: "min-w-[160px]" },
];

function Value({ v }: { v: ProfileValue }) {
  if (!v.value) return <span className="text-slate-300" title={v.why}>—</span>;
  return (
    <span
      className={v.auto ? "text-slate-500" : "text-slate-800"}
      title={v.auto ? `Suggested automatically${v.why ? ` — ${v.why}` : ""} Edit on the drug page to confirm or change.` : "Entered on the drug page"}
    >
      {v.value}
    </span>
  );
}

function CandidateBadge({ v }: { v: ProfileValue }) {
  if (!v.value) return <span className="text-slate-300" title={v.why}>—</span>;
  const pipe = v.value === "Pipeline";
  return (
    <span
      title={v.auto ? `Suggested automatically — ${v.why ?? ""} Edit on the drug page to confirm or change.` : "Entered on the drug page"}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        pipe ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"
      } ${v.auto ? "border border-dashed border-slate-300" : ""}`}
    >
      {v.value}
    </span>
  );
}

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export default function DrugsTable({ products }: { products: ProductSummary[] }) {
  const [q, setQ] = useState("");
  const [candidate, setCandidate] = useState<"" | "Pipeline" | "Non-pipeline">("");
  const [info, setInfo] = useState<"" | "filled" | "blank">("");
  const [page, setPage] = useState(1);
  // Drugs that only appear in non-primary trials are hidden unless asked for.
  const [includeOther, setIncludeOther] = useState(false);

  const all = useMemo<Row[]>(() => products.map((p) => ({ p, prof: drugProfile(p) })), [products]);
  const otherOnly = useMemo(() => all.filter((r) => r.p.trials === 0).length, [all]);
  const visible = useMemo(() => (includeOther ? all : all.filter((r) => r.p.trials > 0)), [all, includeOther]);
  const counts = useMemo(() => ({
    pipeline: visible.filter((r) => r.prof.candidate.value === "Pipeline").length,
    nonPipeline: visible.filter((r) => r.prof.candidate.value === "Non-pipeline").length,
    filled: visible.filter((r) => r.p.has_info).length,
  }), [visible]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible.filter(({ p, prof }) => {
      if (candidate && prof.candidate.value !== candidate) return false;
      if (info === "filled" && !p.has_info) return false;
      if (info === "blank" && p.has_info) return false;
      if (!needle) return true;
      return [p.name, ...Object.values(prof).map((v) => v.value)].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [visible, q, candidate, info]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const reset = () => setPage(1);

  function downloadCsv() {
    const header = ["Drug", "Alias", "Brand name", "Candidate", "No. of trials", "Most advanced trial", "Similar / parent drug",
      "Company", "Therapy class", "Therapy subclass", "Indication", "Values suggested automatically"];
    const lines = rows.map(({ p, prof }) => [
      p.name, prof.aliases.value, prof.brands.value, prof.candidate.value, p.trials, highestPhase(p.trial_phases),
      prof.parent.value, prof.company.value, prof.therapyClass.value, prof.therapySubclass.value, prof.indication.value,
      (Object.entries(prof) as [string, ProfileValue][]).filter(([, v]) => v.auto && v.value).map(([k]) => k).join(" "),
    ].map(csvCell).join(","));
    const blob = new Blob(["﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `drugs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const select = "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); reset(); }}
          placeholder="Find a drug — name, alias, brand, company, class or indication…"
          className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <div className="flex flex-wrap gap-2">
          <select value={candidate} onChange={(e) => { setCandidate(e.target.value as typeof candidate); reset(); }} className={select} title="Pipeline candidate?">
            <option value="">Pipeline &amp; non-pipeline ({visible.length.toLocaleString()})</option>
            <option value="Pipeline">Pipeline ({counts.pipeline.toLocaleString()})</option>
            <option value="Non-pipeline">Non-pipeline ({counts.nonPipeline.toLocaleString()})</option>
          </select>
          <select value={info} onChange={(e) => { setInfo(e.target.value as typeof info); reset(); }} className={select} title="Profiles checked by hand">
            <option value="">All profiles</option>
            <option value="filled">Checked by hand ({counts.filled.toLocaleString()})</option>
            <option value="blank">Automatic only ({(visible.length - counts.filled).toLocaleString()})</option>
          </select>
          {otherOnly > 0 && (
            <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-600"
                   title="Drugs whose trials are all comorbidity / weight-related / not obesity">
              <input type="checkbox" checked={includeOther} onChange={(e) => { setIncludeOther(e.target.checked); reset(); }} />
              + {otherOnly.toLocaleString()} only in non-primary trials
            </label>
          )}
          <button type="button" onClick={downloadCsv}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  title="Download this list (all pages) as a CSV file for Excel">
            Download CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>{rows.length.toLocaleString()} drugs</span>
        <span className="text-xs">
          <span className="text-slate-800">Dark</span> = checked by hand · <span className="text-slate-500">grey</span> = suggested
          automatically from the trials and a reference list (hover to see why) — open a drug to confirm or change.
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={c.key} className={`px-2.5 py-3 align-bottom font-semibold ${c.width} ${c.key === "trials" ? "text-right" : ""} ${
                  i === 0 ? "sticky left-0 z-10 bg-slate-50 shadow-[1px_0_0_#e2e8f0]" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-slate-400">No drugs match.</td></tr>
            ) : (
              shown.map(({ p, prof }) => (
                <tr key={p.slug} className="group align-top hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-2.5 py-2.5 shadow-[1px_0_0_#e2e8f0] group-hover:bg-slate-50">
                    <Link href={`/drugs/${encodeURIComponent(p.slug)}`} className="font-medium text-brand-600 hover:underline">{p.name}</Link>
                  </td>
                  <td className="px-2.5 py-2.5"><Value v={prof.aliases} /></td>
                  <td className="px-2.5 py-2.5"><Value v={prof.brands} /></td>
                  <td className="px-2.5 py-2.5"><CandidateBadge v={prof.candidate} /></td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">
                    <span className="font-medium text-slate-800">{p.trials}</span>
                    {p.all_trials > p.trials && (
                      <span className="ml-1 text-xs text-slate-400" title="Other stored trials (comorbidity / weight-related / not obesity)">+{p.all_trials - p.trials}</span>
                    )}
                    <div className="text-[11px] text-slate-400">{highestPhase(p.trial_phases)}</div>
                  </td>
                  <td className="px-2.5 py-2.5"><Value v={prof.parent} /></td>
                  <td className="px-2.5 py-2.5"><Value v={prof.company} /></td>
                  <td className="px-2.5 py-2.5">
                    <Value v={prof.therapyClass} />
                    {prof.therapySubclass.value && <div className="text-xs"><Value v={prof.therapySubclass} /></div>}
                  </td>
                  <td className="px-2.5 py-2.5"><Value v={prof.indication} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((x) => x - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span className="text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((x) => x + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
