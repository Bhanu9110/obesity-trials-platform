"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProductSummary } from "@/lib/types";
import { highestPhase } from "@/lib/format";
import { matchDrug } from "@/lib/drugSearch";
import { REG_GROUPS, regGroup, shortStatus } from "@/lib/regulatory";
import { dateText } from "@/lib/milestones";

const PAGE = 50;

// `search`: the Drugs page's own search box drives the table (it then shows no box of its own).
export default function DrugsTable({ products, search }: { products: ProductSummary[]; search?: string }) {
  const [ownQ, setQ] = useState("");
  const q = search ?? ownQ;
  const [info, setInfo] = useState<"" | "filled" | "blank" | "abstracts">("");
  const [page, setPage] = useState(1);
  // Drugs that only appear in non-primary trials (comorbidity, weight-related, not obesity)
  // are hidden unless asked for. Drugs known only from conference abstracts (no trial yet) are shown.
  const [includeOther, setIncludeOther] = useState(false);
  const otherOnly = useMemo(() => products.filter((p) => p.trials === 0 && !p.abstracts).length, [products]);
  const visible = useMemo(
    () => (includeOther ? products : products.filter((p) => p.trials > 0 || p.abstracts > 0)),
    [products, includeOther],
  );

  // Search: name, brand names, every alias / code name the database knows, company, class, modality.
  const { rows, via } = useMemo(() => {
    const via = new Map<string, string>(); // slug -> the alias that matched
    const out = visible.filter((p) => {
      if (info === "filled" && !p.has_info) return false;
      if (info === "blank" && p.has_info) return false;
      if (info === "abstracts" && !(p.abstracts > 0 && p.nct_trials === 0)) return false;
      const m = matchDrug(p, q, [p.modality]);
      if (m.via) via.set(p.slug, m.via);
      return m.hit;
    });
    return { rows: out, via };
  }, [visible, q, info]);

  useEffect(() => { setPage(1); }, [search]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const filled = visible.filter((p) => p.has_info).length;
  const abstractOnly = visible.filter((p) => p.abstracts > 0 && p.nct_trials === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        {search === undefined && <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Find a drug, brand or code name…"
          className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-500"
        />}
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
          {abstractOnly > 0 && <option value="abstracts">From conference abstracts, no NCT trial yet ({abstractOnly.toLocaleString()})</option>}
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

      <div className="text-sm text-slate-500">
        {rows.length.toLocaleString()} drugs
        {rows.some((p) => p.conference_trials > 0) && (
          <span className="ml-3 text-xs text-slate-400"><span className="text-amber-600">*</span> trial reported in a conference abstract or company report, no ClinicalTrials.gov record yet</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Drug</th>
              <th className="px-4 py-3 text-right font-semibold" title="Primary-obesity trials (+ other stored trials)">Trials</th>
              <th className="px-4 py-3 font-semibold">Most advanced trial</th>
              <th className="px-4 py-3 font-semibold">Modality</th>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold">Regulatory status</th>
              <th className="px-4 py-3 font-semibold">Next milestone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">No drugs match.</td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.slug} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/drugs/${encodeURIComponent(p.slug)}`} className="font-medium text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                    {p.abstracts > 0 && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-amber-200"
                            title={`${p.abstracts} conference abstract${p.abstracts === 1 ? "" : "s"} (e.g. ADA 2026)`}>
                        {p.abstracts} abstract{p.abstracts === 1 ? "" : "s"}
                      </span>
                    )}
                    {via.has(p.slug) && <div className="mt-0.5 text-xs text-slate-500">Also known as <b className="font-medium text-slate-700">{via.get(p.slug)}</b></div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {p.trials}
                    {p.conference_trials > 0 && (
                      <span className="text-[10px] text-amber-600" title={`Reported in ${p.abstract_sources ?? "a conference abstract"} — no ClinicalTrials.gov record yet`}>*</span>
                    )}
                    {p.all_trials > p.trials && (
                      <span className="ml-1 text-xs text-slate-400" title="Other stored trials (comorbidity / weight-related / not obesity)">
                        +{p.all_trials - p.trials}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {p.trial_phases.length ? highestPhase(p.trial_phases) : p.phase ? <span title="From the drug profile (no trial yet)">{p.phase}</span> : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{p.modality || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.drug_class || <span className="text-slate-300">—</span>}</td>
                  <td className="max-w-[260px] px-4 py-2.5 text-slate-700" title={p.regulatory_status ?? undefined}>
                    {p.regulatory_status ? (() => {
                      const g = REG_GROUPS.find((x) => x.key === regGroup(p.regulatory_status, p.approved))!;
                      return <><span className={`mr-1.5 rounded px-1.5 py-px text-[10px] font-semibold uppercase ring-1 ${g.chip}`}>{g.key === "review" ? "Filed" : g.label.split(" ")[0]}</span><span className="text-xs">{shortStatus(p.regulatory_status.replace(/^(approved|investigational)\s*[—-]\s*/i, ""), 55)}</span></>;
                    })() : p.approved === "Yes" ? "Approved" : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="max-w-[240px] px-4 py-2.5 text-xs text-slate-700" title={p.next_milestone?.title}>
                    {p.next_milestone
                      ? <><b className="font-semibold text-slate-900">{dateText(p.next_milestone.date_label)}</b><div className="line-clamp-2 text-slate-600">{p.next_milestone.title}</div></>
                      : <span className="text-slate-300">—</span>}
                  </td>
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
