"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { setUrlParams, startParams } from "@/lib/urlState";
import type { ProductSummary } from "@/lib/types";
import DrugsTable from "@/components/DrugsTable";
import { matchDrug } from "@/lib/drugSearch";
import { icons } from "@/components/shell/icons";
import { REG_GROUPS, regGroup, shortStatus, type RegGroup } from "@/lib/regulatory";
import { KIND_META, dateText } from "@/lib/milestones";

// Drugs: a card grid (default) or the detailed table. Search, stage filter and sort.

import { devStage, STAGE_META, type StageKey } from "@/lib/devStage";
import { cleanNames, splitNames } from "@/lib/aliases";
import { classForQuery, classMembers, classSummary, targetsFor, KIND_ORDER } from "@/lib/drugClasses";
import ClassBanner, { ClassTag } from "@/components/ClassBanner";

// Stage chips: the development stage (lib/devStage.ts), not only the highest trial phase, so a drug
// approved in any country shows as Approved and a discontinued one as Discontinued.
const STAGES: { key: "" | StageKey; label: string }[] = [
  { key: "", label: "All stages" },
  { key: "approved", label: "Approved" },
  { key: "filed", label: "Filed" },
  { key: "p3", label: "Phase 3" },
  { key: "p2", label: "Phase 2" },
  { key: "p1", label: "Phase 1" },
  { key: "early", label: "Preclinical / no NCT yet" },
  { key: "stopped", label: "Discontinued / withdrawn" },
  { key: "inactive", label: "No active development" },
];
const LADDER = ["P1", "P2", "P3", "Appr."];
// A drug with no ClinicalTrials.gov trial yet, known from conference abstracts (e.g. ADA 2026).
const abstractOnly = (p: ProductSummary) => p.abstracts > 0 && p.nct_trials === 0;
const STEP = 24;

export default function DrugsExplorer({ products, initial: fromServer = {}, canExport = false }: { products: ProductSummary[]; initial?: Record<string, string>; canExport?: boolean }) {
  const [initial] = useState(() => startParams(fromServer));
  // Every filter starts from the address (?q=…&stage=…) and is written back to it, so the browser's
  // Back button (or "All drugs" on a drug page) returns to the same filtered list.
  const pick = <T extends string>(v: string | undefined, ok: readonly T[], d: T): T => (ok as readonly string[]).includes(v ?? "") ? (v as T) : d;
  const [view, setView] = useState<"grid" | "table">(pick(initial.view, ["grid", "table"] as const, "grid"));
  const [q, setQ] = useState(initial.q ?? "");
  const [stage, setStage] = useState<"" | StageKey>(pick(initial.stage, STAGES.map((s) => s.key), ""));
  const [sort, setSort] = useState<"trials" | "phase" | "name">(pick(initial.sort, ["trials", "phase", "name"] as const, "trials"));
  const [limit, setLimit] = useState(Math.max(STEP, Math.min(2000, Number(initial.n) || STEP)));
  const [reg, setReg] = useState<"" | RegGroup | "milestone">(pick<"" | RegGroup | "milestone">(initial.reg, ["", "milestone", ...REG_GROUPS.map((g) => g.key)], ""));
  useEffect(() => {
    setUrlParams({ q: q.trim(), stage, reg, sort: sort === "trials" ? "" : sort, view: view === "grid" ? "" : view, n: limit > STEP ? limit : "" });
  }, [q, stage, reg, sort, view, limit]);

  const listed = useMemo(() => products.filter((p) => p.trials > 0 || p.abstracts > 0), [products]);
  const regCounts = useMemo(() => {
    const c: Record<string, number> = { milestone: listed.filter((p) => p.next_milestone).length };
    for (const p of listed) { const g = regGroup(p.regulatory_status, p.approved); c[g] = (c[g] ?? 0) + 1; }
    return c;
  }, [listed]);
  // Regulatory filter applies to both views (the table gets the filtered list).
  const base = useMemo(() => !reg ? listed
    : reg === "milestone" ? listed.filter((p) => p.next_milestone)
      : listed.filter((p) => regGroup(p.regulatory_status, p.approved) === reg), [listed, reg]);
  const forTable = useMemo(() => !reg ? products : products.filter((p) => base.includes(p)), [products, base, reg]);
  const stages = useMemo(() => new Map(products.map((p) => [p.slug, devStage(p)])), [products]);
  const stageOf = (p: ProductSummary) => stages.get(p.slug)!;
  const inStage = (p: ProductSummary, k: StageKey) => stageOf(p).key === k;
  // A search that names a drug class ("GLP-1 agonists") lists every drug of the class.
  const targets = useMemo(() => targetsFor(products), [products]);
  const cls = useMemo(() => classForQuery(q), [q]);
  const members = useMemo(() => (cls ? classMembers(targets, cls) : null), [cls, targets]);
  // Search: name, brand names, every alias / code name the database knows, company, class.
  // 1) what the search finds (a class: its drugs), 2) the stage chip narrows it down.
  // The stage chips count only what the search found.
  const { matched, via } = useMemo(() => {
    const via = new Map<string, string>(); // slug -> the alias that matched
    const matched = base.filter((p) => {
      if (members) return members.has(p);
      const m = matchDrug(p, q);
      if (m.via) via.set(p.slug, m.via);
      return m.hit;
    });
    return { matched, via };
  }, [base, q, members]);
  const rows = useMemo(() => {
    const out = matched.filter((p) => !stage || inStage(p, stage));
    // In a class: single-target first, then dual, triple, combinations.
    const kind = (p: ProductSummary) => (members ? KIND_ORDER[members.get(p)?.kind ?? "other"] : 0);
    // A drug whose name or code matches the search exactly comes first.
    const exact = (p: ProductSummary) => (q.trim() && [p.name, via.get(p.slug)].some((n) => n?.toLowerCase() === q.trim().toLowerCase()) ? 1 : 0);
    out.sort((a, b) => exact(b) - exact(a) || (sort !== "name" ? kind(a) - kind(b) : 0) || (
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "phase" ? STAGE_META[stageOf(b).key].order - STAGE_META[stageOf(a).key].order || stageOf(b).reached - stageOf(a).reached || b.trials - a.trials
          : b.trials - a.trials || a.name.localeCompare(b.name)));
    return out;
  }, [matched, via, q, stage, sort, stages, members]);

  const counts = useMemo(() => STAGES.map((s) => (!s.key ? matched.length
    : matched.filter((p) => inStage(p, s.key as StageKey)).length)), [matched, stages]);
  // A class search shows its drugs grouped by development stage, so start from "All stages".
  // (not on first load: a stage chosen before opening a drug is kept when coming back)
  const lastCls = useRef(cls?.key ?? "");
  useEffect(() => {
    const k = cls?.key ?? "";
    if (k === lastCls.current) return;
    lastCls.current = k;
    if (k) setStage("");
  }, [cls]);
  const groups = useMemo(() => !members ? null
    : STAGES.filter((s) => s.key).map((s) => ({ key: s.key as StageKey, label: s.label, drugs: rows.filter((p) => inStage(p, s.key as StageKey)) }))
      .filter((g) => g.drugs.length), [members, rows, stages]);

  const card = (p: ProductSummary) => {
                const st = stageOf(p);
                const top = st.key === "approved" ? 4 : st.reached;
                const dim = st.key === "stopped" || st.key === "inactive";
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
                          {[p.brand_names, cleanNames(splitNames(p.aliases), p.name).join(", ")].filter(Boolean).join(" · ") || p.sponsor || (undisclosed ? "Drug class only — name not disclosed" : "Profile not filled in yet")}
                        </div>
                        {members?.get(p)?.label && <div className="mt-1"><ClassTag {...members.get(p)!} /></div>}
                        {via.has(p.slug) && (
                          <div className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
                            Also known as {via.get(p.slug)}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        {onlyAbs && p.trials === 0 ? (
                          <>
                            <div className="font-display text-2xl font-semibold leading-none tabular-nums text-brand-600">{p.abstracts}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{p.reports_only ? (p.abstracts === 1 ? "report" : "reports") : p.abstracts === 1 ? "abstract" : "abstracts"}</div>
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
                        <span title={st.detail} className={`rounded px-1.5 py-px normal-case tracking-normal ring-1 ${STAGE_META[st.key].chip}`}>
                          {st.label}{dim && st.reached ? ` · reached P${st.reached}` : ""}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {LADDER.map((l, i) => (
                          <div key={l} className="space-y-1">
                            <div className={`h-1.5 rounded-full ${i < top ? (dim ? "bg-slate-300" : "") : "bg-slate-100"}`}
                                 style={i < top && !dim ? { background: `linear-gradient(90deg, #22d3ee, ${["#38bdf8", "#818cf8", "#a78bfa", "#34d399"][i]})`, boxShadow: "0 0 10px -2px rgb(34 211 238 / 0.6)" } : undefined} />
                            <div className={`text-center text-[10px] ${i < top ? "text-slate-700" : "text-slate-400"}`}>{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {(p.regulatory_status || p.next_milestone) && (
                      <div className="mt-3 space-y-1 border-t border-slate-100 pt-2.5 text-xs">
                        {p.regulatory_status && (() => {
                          const g = REG_GROUPS.find((x) => x.key === regGroup(p.regulatory_status, p.approved))!;
                          return (
                            <div className="flex items-start gap-1.5" title={p.regulatory_status}>
                              <span className={`mt-px shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase ring-1 ${g.chip}`}>{g.key === "review" ? "Filed" : g.label.split(" ")[0]}</span>
                              <span className="line-clamp-1 text-slate-600">{shortStatus(p.regulatory_status.replace(/^(approved|investigational)\s*[—-]\s*/i, ""), 70)}</span>
                            </div>
                          );
                        })()}
                        {p.next_milestone && (
                          <div className="flex items-start gap-1.5" title={p.next_milestone.title}>
                            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_META[p.next_milestone.kind].dot}`} />
                            <span className="line-clamp-1 text-slate-600"><b className="font-semibold text-slate-800">{dateText(p.next_milestone.date_label)}</b> · {p.next_milestone.title}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {(p.drug_class || p.candidate || p.abstracts > 0) && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.abstracts > 0 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 ring-1 ring-amber-200" title={`${p.abstracts} conference abstract${p.abstracts === 1 ? "" : "s"}`}>{p.abstract_sources ?? "Abstracts"}</span>}
                        {p.candidate && <span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700 ring-1 ring-accent-200">{p.candidate}</span>}
                        {p.drug_class && <span className="truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">{p.drug_class}</span>}
                      </div>
                    )}
                  </Link>
                );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(STEP); }}
                 placeholder="Find a drug, brand, code name, company — or a class: GLP-1 agonists, amylin analogues…"
                 className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none" />
        </div>
        <select value={reg} onChange={(e) => { setReg(e.target.value as typeof reg); setLimit(STEP); }} aria-label="Regulatory status"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
          <option value="">Any regulatory status</option>
          {REG_GROUPS.filter((g) => regCounts[g.key]).map((g) => <option key={g.key} value={g.key}>{g.label} ({regCounts[g.key].toLocaleString()})</option>)}
          {regCounts.milestone > 0 && <option value="milestone">With an upcoming milestone ({regCounts.milestone.toLocaleString()})</option>}
        </select>
        {canExport && (
          <Link href={`/export?${new URLSearchParams({ type: "drugs", ...(q.trim() ? { q: q.trim() } : {}), ...(stage ? { stage } : {}), ...(reg ? { reg } : {}) })}`}
                title="Download this list — Excel, PDF, CSV or Word, with the columns you choose"
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-brand-500/50 hover:text-brand-700">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></svg>
            Export
          </Link>
        )}
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

      {view === "table" ? <DrugsTable products={forTable} search={q} initial={fromServer} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map((s, i) => (s.key && !counts[i] && stage !== s.key ? null :
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

          {cls && members && <ClassBanner label={cls.label} count={matched.length} noun={matched.length === 1 ? "drug" : "drugs"}
                                           summary={classSummary(matched.map((p) => members.get(p)!).filter(Boolean))}
                                           note="Grouped by development stage. Dual / triple agonists and combinations are included and labelled on each card; use the stage chips to show one stage." />}
          <p className="px-1 text-sm text-slate-500">
            <b className="font-display text-base font-semibold text-slate-950">{rows.length.toLocaleString()}</b> drugs
            {rows.some((p) => p.conference_trials > 0) && (
              <span className="ml-3 text-xs text-slate-400"><span className="text-amber-600">*</span> trial reported in a conference abstract or company report, no ClinicalTrials.gov record yet</span>
            )}
          </p>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
              <div className="font-display text-base font-semibold text-slate-900">No drug matches</div>
              <p className="mt-1 text-sm text-slate-500">Try another name or a broader stage.</p>
            </div>
          ) : (
            groups ? (
              <div className="space-y-5">
                {groups.map((g) => (
                  <section key={g.key}>
                    <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
                      <span className={`rounded px-1.5 py-px text-[11px] ring-1 ${STAGE_META[g.key].chip}`}>{g.label}</span>
                      <span className="font-normal text-slate-500">{g.drugs.length} drug{g.drugs.length === 1 ? "" : "s"}</span>
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{g.drugs.map(card)}</div>
                  </section>
                ))}
              </div>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.slice(0, limit).map(card)}
            </div>
            )
          )}

          {!groups && rows.length > limit && (
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
