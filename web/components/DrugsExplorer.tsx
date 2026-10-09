"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProductSummary } from "@/lib/types";
import DrugsTable from "@/components/DrugsTable";
import { icons } from "@/components/shell/icons";

// Drugs: a card grid (default) or the detailed table. Search, stage filter and sort.

const level = (p: string) => (p.includes("PHASE4") ? 4 : p.includes("PHASE3") ? 3 : p.includes("PHASE2") ? 2 : p.includes("PHASE1") ? 1 : 0);
const topLevel = (phases: string[]) => phases.reduce((m, p) => Math.max(m, level(p)), 0);
// A drug with no ClinicalTrials.gov trial yet, known from conference abstracts (e.g. ADA 2026);
// its trial count is the clinical trials those abstracts report.
const abstractOnly = (p: ProductSummary) => p.abstracts > 0 && p.nct_trials === 0;
// Most advanced phase: from its trials, else from its profile ("Phase 1/2" -> 2).
const topOf = (p: ProductSummary) => p.trial_phases.length ? topLevel(p.trial_phases)
  : Math.max(0, ...[...(p.phase ?? "").matchAll(/\d/g)].map((m) => Number(m[0])).filter((n) => n <= 4));
const STAGES = [
  { key: 0, label: "All stages" },
  { key: 1, label: "Phase 1" },
  { key: 2, label: "Phase 2" },
  { key: 3, label: "Phase 3" },
  { key: 4, label: "Phase 4" },
  { key: 5, label: "No NCT yet (conference)" },
] as const;
const LADDER = ["P1", "P2", "P3", "P4"];
const STEP = 24;

export default function DrugsExplorer({ products }: { products: ProductSummary[] }) {
  const [view, setView] = useState<"grid" | "table">("grid");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState(0);
  const [sort, setSort] = useState<"trials" | "phase" | "name">("trials");
  const [limit, setLimit] = useState(STEP);

  const base = useMemo(() => products.filter((p) => p.trials > 0 || p.abstracts > 0), [products]);
  const inStage = (p: ProductSummary, k: number) => (k === 5 ? abstractOnly(p) : !abstractOnly(p) && topOf(p) === k);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = base.filter((p) => {
      if (stage && !inStage(p, stage)) return false; // most advanced phase is exactly this one
      if (!needle) return true;
      return [p.name, p.aliases, p.brand_names, p.sponsor, p.drug_class, p.therapy_subclass, p.moa]
        .some((v) => v?.toLowerCase().includes(needle));
    });
    return out.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "phase" ? topOf(b) - topOf(a) || b.trials - a.trials
          : b.trials - a.trials || a.name.localeCompare(b.name));
  }, [base, q, stage, sort]);

  const counts = useMemo(() => STAGES.map((s) => (s.key === 0 ? base.length
    : base.filter((p) => inStage(p, s.key)).length)), [base]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(STEP); }}
                 placeholder="Find a drug, brand, code name, company or class…"
                 className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none" />
        </div>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
          <button type="button" onClick={() => setView("grid")} title="Cards"
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${view === "grid" ? "bg-brand-500/15 text-brand-700" : "text-slate-500 hover:text-slate-900"}`}>
            {icons.grid} Cards
          </button>
          <button type="button" onClick={() => setView("table")} title="Table"
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${view === "table" ? "bg-brand-500/15 text-brand-700" : "text-slate-500 hover:text-slate-900"}`}>
            {icons.list} Table
          </button>
        </div>
      </div>

      {view === "table" ? <DrugsTable products={products} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map((s, i) => (
              <button key={s.key} type="button" onClick={() => { setStage(s.key); setLimit(STEP); }}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                        stage === s.key ? "bg-brand-500/15 text-brand-700 ring-brand-500/40" : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900"}`}>
                {s.label} <span className="ml-1 tabular-nums opacity-70">{counts[i].toLocaleString()}</span>
              </button>
            ))}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
                    className="ml-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="trials">Most trials</option>
              <option value="phase">Most advanced</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>

          <p className="px-1 text-sm text-slate-500">
            <b className="font-display text-base font-semibold text-slate-950">{rows.length.toLocaleString()}</b> drugs
            {rows.some((p) => p.conference_trials > 0) && (
              <span className="ml-3 text-xs text-slate-400"><span className="text-amber-600">*</span> trial reported at a conference (e.g. ADA 2026), no ClinicalTrials.gov record yet</span>
            )}
          </p>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
              <div className="font-display text-base font-semibold text-slate-900">No drug matches</div>
              <p className="mt-1 text-sm text-slate-500">Try another name or a broader stage.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.slice(0, limit).map((p) => {
                const top = topOf(p);
                const onlyAbs = abstractOnly(p);
                const undisclosed = /^undisclosed/i.test(p.name);
                return (
                  <Link key={p.slug} href={`/drugs/${encodeURIComponent(p.slug)}`}
                        className="glass group relative overflow-hidden rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-glow">
                    <span className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-accent-500/0 blur-2xl transition group-hover:bg-accent-500/25" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`truncate font-display text-[17px] font-semibold ${undisclosed ? "text-slate-600" : "text-slate-950"} group-hover:text-brand-700`}>{p.name}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {[p.brand_names, p.aliases].filter(Boolean).join(" · ") || p.sponsor || (undisclosed ? "Drug class only — name not disclosed" : "Profile not filled in yet")}
                        </div>
                      </div>
                      <div className="text-right">
                        {onlyAbs && p.trials === 0 ? (
                          <>
                            <div className="font-display text-2xl font-semibold leading-none tabular-nums text-brand-600">{p.abstracts}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{p.abstracts === 1 ? "abstract" : "abstracts"}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-display text-2xl font-semibold leading-none tabular-nums text-brand-600"
                                 title={onlyAbs ? `Clinical trial${p.trials === 1 ? "" : "s"} reported at ${p.abstract_sources ?? "a conference"} — no ClinicalTrials.gov record yet` : undefined}>
                              {p.trials}{onlyAbs && <span className="align-super text-[10px] text-amber-600">*</span>}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{p.trials === 1 ? "trial" : "trials"}</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <span>Development</span>
                        <span className="text-slate-400">{top ? `up to Phase ${top}` : p.phase && onlyAbs ? p.phase : "phase n/a"}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {LADDER.map((l, i) => (
                          <div key={l} className="space-y-1">
                            <div className={`h-1.5 rounded-full ${i < top ? "" : "bg-slate-100"}`}
                                 style={i < top ? { background: `linear-gradient(90deg, #22d3ee, ${["#38bdf8", "#818cf8", "#a78bfa", "#f472b6"][i]})`, boxShadow: "0 0 10px -2px rgb(34 211 238 / 0.6)" } : undefined} />
                            <div className={`text-center text-[10px] ${i < top ? "text-slate-700" : "text-slate-400"}`}>{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {(p.drug_class || p.candidate || p.approved === "Yes" || p.abstracts > 0) && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.abstracts > 0 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-amber-200" title={`${p.abstracts} conference abstract${p.abstracts === 1 ? "" : "s"}`}>{p.abstract_sources ?? "Abstracts"}</span>}
                        {p.approved === "Yes" && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-200">approved</span>}
                        {p.candidate && <span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700 ring-1 ring-accent-200">{p.candidate}</span>}
                        {p.drug_class && <span className="truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">{p.drug_class}</span>}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {rows.length > limit && (
            <div className="flex justify-center pt-2">
              <button type="button" onClick={() => setLimit((l) => l + STEP * 2)}
                      className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950">
                Show more · {(rows.length - limit).toLocaleString()} left
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
