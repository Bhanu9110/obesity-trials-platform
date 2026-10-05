"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProductTrial } from "@/lib/types";
import {
  CONTINENT_ORDER, OBESITY_CLASSES, OBESITY_CLASS_ORDER, TRIAL_STATUS_ORDER, formatMonthYear, formatPhase,
  phaseRank, sortContinents, statusInfo, trialUrl,
} from "@/lib/format";

// Trials of one drug: a clickable phase bar, a summary line, one toolbar, and the
// trials as two-line entries grouped by phase (title + status, then NCT ID,
// sponsor, start, participants, location). Plain "Obesity" is not repeated on
// every trial — only the extra conditions are listed.

const NO_PHASE = "__none__";
const ACTIVE = "__active__";
const SELECT = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700";
const GROUP_PREVIEW = 8;   // trials shown per phase group before "Show all"
const FLAT_PREVIEW = 40;   // trials shown in a flat (non-grouped) list before "Show more"

type Sort = "phase" | "start" | "enrollment" | "sponsor";
type SponsorFilter = "" | "industry" | "academic";

const phaseKey = (t: ProductTrial) => t.phase || NO_PHASE;
const phaseLabel = (p: string) => (p === NO_PHASE ? "No phase" : formatPhase(p));
const rankOf = (p: string) => phaseRank(p === NO_PHASE ? null : p);
const isIndustry = (t: ProductTrial) => t.lead_sponsor_class === "INDUSTRY";

/** Phase-bar colour: later stage = darker. */
function phaseColour(p: string): string {
  const r = rankOf(p);
  if (r >= 4) return "bg-blue-900 text-white";
  if (r >= 3) return "bg-blue-700 text-white";
  if (r >= 2) return "bg-blue-500 text-white";
  if (r >= 1) return "bg-blue-400 text-white";
  if (r > 0) return "bg-blue-200 text-blue-900";
  if (r === 0) return "bg-slate-300 text-slate-700";
  return "bg-slate-200 text-slate-600";
}

// Conditions every obesity trial has — not worth repeating on each entry.
const PLAIN_OBESITY = /^(?:obes(?:e|ity)|overweight|adult obesity|(?:overweight|obesity)\s*(?:and|or|&|,|\/)\s*(?:obes(?:e|ity)|overweight))$/i;

function StatusBadge({ s, className = "" }: { s: string | null; className?: string }) {
  const info = statusInfo(s);
  if (!info) return null;
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${info.badge} ${className}`}>{info.label}</span>;
}

function TrialEntry({ t, showPhase }: { t: ProductTrial; showPhase: boolean }) {
  const extra = t.indication.filter((c) => !PLAIN_OBESITY.test(c.trim()));
  const start = formatMonthYear(t.start_date);
  const cls = t.obesity_class !== "primary" ? OBESITY_CLASSES[t.obesity_class] : null;
  const meta: React.ReactNode[] = [
    <span key="id" className="font-mono text-xs text-brand-600">{t.nct_id}</span>,
    <span key="sp" className="text-slate-600">
      {t.sponsor || "Sponsor not given"}
      {isIndustry(t) && <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Industry</span>}
    </span>,
  ];
  if (showPhase) meta.push(<span key="ph" className="font-medium text-slate-700">{phaseLabel(phaseKey(t))}</span>);
  if (start) meta.push(<span key="st">Start {start}</span>);
  if (t.enrollment != null) meta.push(<span key="en">{t.enrollment.toLocaleString()} participant{t.enrollment === 1 ? "" : "s"}</span>);
  if (t.continents.length) meta.push(<span key="co">{sortContinents(t.continents).join(", ")}</span>);

  return (
    <li>
      <Link href={trialUrl(t.nct_id)} className="group block px-5 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
        <div className="flex items-start justify-between gap-4">
          <span className="text-[14px] font-semibold leading-snug text-slate-900 group-hover:text-brand-700">
            {t.title || <span className="font-normal italic text-slate-400">Title appears after the next sync</span>}
          </span>
          <StatusBadge s={t.overall_status} className="hidden sm:inline-block" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-500 sm:gap-x-2">
          {/* on phones the status sits on this line so the title gets the full width */}
          <StatusBadge s={t.overall_status} className="sm:hidden" />
          {meta.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden className="hidden text-slate-300 sm:inline">·</span>}
              {m}
            </span>
          ))}
        </div>
        {(extra.length > 0 || cls) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-400">
            {cls && (
              <span title={t.obesity_reason ?? undefined} className={`rounded px-1.5 py-0.5 font-medium ${cls.badge}`}>{cls.short}</span>
            )}
            {extra.length > 0 && <span className="mr-0.5">Also:</span>}
            {extra.slice(0, 4).map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{c}</span>)}
            {extra.length > 4 && <span title={extra.slice(4).join(", ")}>+{extra.length - 4}</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

export default function DrugTrialsTable({ trials: allTrials }: { trials: ProductTrial[] }) {
  const classCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of allTrials) m[t.obesity_class] = (m[t.obesity_class] ?? 0) + 1;
    return m;
  }, [allTrials]);
  // Primary-obesity trials by default (all of them if the drug has none).
  const [scope, setScope] = useState(() => (allTrials.some((t) => t.obesity_class === "primary") ? "primary" : "all"));
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState("");
  const [sponsor, setSponsor] = useState<SponsorFilter>("");
  const [status, setStatus] = useState("");
  const [continent, setContinent] = useState("");
  const [sort, setSort] = useState<Sort>("phase");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flatLimit, setFlatLimit] = useState(FLAT_PREVIEW);

  const scoped = useMemo(
    () => (scope === "all" ? allTrials : allTrials.filter((t) => t.obesity_class === scope)),
    [allTrials, scope],
  );

  // Every filter except phase (the phase bar shows how the rest splits by phase).
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((t) => {
      if (sponsor === "industry" && !isIndustry(t)) return false;
      if (sponsor === "academic" && isIndustry(t)) return false;
      if (status === ACTIVE ? !statusInfo(t.overall_status)?.active : status && t.overall_status !== status) return false;
      if (continent && !t.continents.includes(continent)) return false;
      if (!needle) return true;
      return (
        t.nct_id.toLowerCase().includes(needle) ||
        (t.title ?? "").toLowerCase().includes(needle) ||
        (t.sponsor ?? "").toLowerCase().includes(needle) ||
        t.indication.some((i) => i.toLowerCase().includes(needle))
      );
    });
  }, [scoped, q, sponsor, status, continent]);

  const phaseCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of base) m.set(phaseKey(t), (m.get(phaseKey(t)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => rankOf(b[0]) - rankOf(a[0]));
  }, [base]);

  const rows = useMemo(() => {
    const r = phase ? base.filter((t) => phaseKey(t) === phase) : base.slice();
    const byStart = (a: ProductTrial, b: ProductTrial) => (b.start_date ?? "").localeCompare(a.start_date ?? "");
    const cmp: Record<Sort, (a: ProductTrial, b: ProductTrial) => number> = {
      phase: (a, b) => rankOf(phaseKey(b)) - rankOf(phaseKey(a)) || byStart(a, b) || b.nct_id.localeCompare(a.nct_id),
      start: (a, b) => byStart(a, b) || b.nct_id.localeCompare(a.nct_id),
      enrollment: (a, b) => (b.enrollment ?? -1) - (a.enrollment ?? -1),
      sponsor: (a, b) => (a.sponsor ?? "~").localeCompare(b.sponsor ?? "~") || byStart(a, b),
    };
    return r.sort(cmp[sort]);
  }, [base, phase, sort]);

  const summary = useMemo(() => {
    const years = rows.map((t) => Number(t.start_date?.slice(0, 4))).filter((y) => y > 1900);
    const withN = rows.filter((t) => t.enrollment != null);
    return {
      active: rows.filter((t) => statusInfo(t.overall_status)?.active).length,
      hasStatus: rows.some((t) => t.overall_status),
      industry: rows.filter(isIndustry).length,
      participants: withN.reduce((s, t) => s + (t.enrollment ?? 0), 0),
      hasParticipants: withN.length > 0,
      years: years.length ? [Math.min(...years), Math.max(...years)] : null,
    };
  }, [rows]);

  const statusOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of scoped) if (t.overall_status) m.set(t.overall_status, (m.get(t.overall_status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => TRIAL_STATUS_ORDER.indexOf(a[0]) - TRIAL_STATUS_ORDER.indexOf(b[0]));
  }, [scoped]);
  const continents = useMemo(() => {
    const s = new Set(scoped.flatMap((t) => t.continents));
    return CONTINENT_ORDER.filter((c) => s.has(c));
  }, [scoped]);
  const industryTotal = useMemo(() => scoped.filter(isIndustry).length, [scoped]);

  const groups = useMemo(() => {
    if (sort !== "phase") return null;
    const g = new Map<string, ProductTrial[]>();
    for (const t of rows) g.set(phaseKey(t), [...(g.get(phaseKey(t)) ?? []), t]);
    return [...g.entries()];
  }, [rows, sort]);

  const filtered = Boolean(q.trim() || phase || sponsor || status || continent);
  const clear = () => { setQ(""); setPhase(""); setSponsor(""); setStatus(""); setContinent(""); };
  const toggle = (set: Set<string>, key: string, update: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key); else n.add(key);
    update(n);
  };
  const totalInBar = phaseCounts.reduce((s, [, n]) => s + n, 0);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="space-y-3 border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Trials ({filtered ? `${rows.length} of ${scoped.length}` : scoped.length})
          </h2>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-500">
              {summary.hasStatus && <span><b className="mr-1 text-[15px] text-slate-900">{summary.active}</b>recruiting / active</span>}
              <span><b className="mr-1 text-[15px] text-slate-900">{summary.industry}</b>industry</span>
              {summary.hasParticipants && <span><b className="mr-1 text-[15px] text-slate-900">{summary.participants.toLocaleString()}</b>participants</span>}
              {summary.years && (
                <span>
                  <b className="mr-1 text-[15px] text-slate-900">
                    {summary.years[0] === summary.years[1] ? summary.years[0] : `${summary.years[0]}–${summary.years[1]}`}
                  </b>
                  start{summary.years[0] === summary.years[1] ? " year" : " years"}
                </span>
              )}
            </div>
          )}
        </div>

        {totalInBar > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Filter by phase">
            {phaseCounts.map(([p, n]) => {
              const on = phase === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhase(on ? "" : p)}
                  title={on ? "Show all phases" : `Show only ${phaseLabel(p)} (${n})`}
                  aria-pressed={on}
                  style={{ flexGrow: n, flexBasis: 0 }}
                  className={`flex min-w-[4.5rem] flex-col items-start justify-center rounded-lg px-2.5 py-1.5 text-left leading-tight transition ${phaseColour(p)} ${
                    on ? "ring-2 ring-slate-900 ring-offset-2" : phase ? "opacity-40 hover:opacity-80" : "hover:brightness-110"
                  }`}
                >
                  <span className="text-[15px] font-bold tabular-nums">{n}</span>
                  <span className="whitespace-nowrap text-[11px]">{phaseLabel(p)}</span>
                </button>
              );
            })}
          </div>
        )}

        {allTrials.length > 0 && (
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, NCT ID, sponsor or condition…"
              className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 lg:min-w-[260px]"
            />
            {industryTotal > 0 && industryTotal < scoped.length && (
              <div className="flex w-full overflow-hidden rounded-lg border border-slate-300 text-sm lg:w-auto" role="group" aria-label="Sponsor type">
                {([["", "All sponsors"], ["industry", `Industry (${industryTotal})`], ["academic", "Non-industry"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSponsor(v)}
                    aria-pressed={sponsor === v}
                    className={`flex-1 whitespace-nowrap px-2 py-2 text-xs sm:px-3 sm:text-sm lg:flex-none ${sponsor === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {statusOptions.length > 0 && (
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} title="Recruitment status">
                  <option value="">Any status</option>
                  <option value={ACTIVE}>Recruiting or active</option>
                  {statusOptions.map(([s, n]) => <option key={s} value={s}>{statusInfo(s)?.label} ({n})</option>)}
                </select>
              )}
              {continents.length > 1 && (
                <select value={continent} onChange={(e) => setContinent(e.target.value)} className={SELECT} title="Continent">
                  <option value="">All continents</option>
                  {continents.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {Object.keys(classCounts).length > 1 && (
                <select
                  value={scope}
                  onChange={(e) => { setScope(e.target.value); setPhase(""); }}
                  className={`${SELECT} ${scope !== "primary" ? "border-amber-400 bg-amber-50" : ""}`}
                  title="Primary-obesity trials, or the other stored trials"
                >
                  {OBESITY_CLASS_ORDER.filter((k) => classCounts[k]).map((k) => (
                    <option key={k} value={k}>{OBESITY_CLASSES[k].label} ({classCounts[k]})</option>
                  ))}
                  <option value="all">All stored trials ({allTrials.length})</option>
                </select>
              )}
              <select value={sort} onChange={(e) => { setSort(e.target.value as Sort); setFlatLimit(FLAT_PREVIEW); }} className={SELECT} title="Sort">
                <option value="phase">Sort: latest phase</option>
                <option value="start">Sort: newest start</option>
                <option value="enrollment">Sort: most participants</option>
                <option value="sponsor">Sort: sponsor A–Z</option>
              </select>
              {filtered && (
                <button type="button" onClick={clear} className="rounded-lg px-3 py-2 text-sm text-brand-600 hover:bg-slate-50">
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          {scoped.length === 0 ? "No active trials currently linked to this drug." : "No trials match these filters."}
        </p>
      ) : groups ? (
        groups.map(([p, list]) => {
          const isCollapsed = collapsed.has(p);
          const shown = expanded.has(p) ? list : list.slice(0, GROUP_PREVIEW);
          return (
            <div key={p}>
              <button
                type="button"
                onClick={() => toggle(collapsed, p, setCollapsed)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 border-y border-slate-100 bg-slate-50 px-5 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <span aria-hidden className={`text-slate-400 transition ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                {phaseLabel(p)}
                <span className="font-normal text-slate-400">{list.length} trial{list.length === 1 ? "" : "s"}</span>
              </button>
              {!isCollapsed && (
                <>
                  <ul className="divide-y divide-slate-100">
                    {shown.map((t) => <TrialEntry key={t.nct_id} t={t} showPhase={false} />)}
                  </ul>
                  {list.length > GROUP_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => toggle(expanded, p, setExpanded)}
                      className="w-full border-t border-slate-100 px-5 py-2 text-left text-[13px] font-medium text-brand-600 hover:bg-slate-50"
                    >
                      {expanded.has(p) ? "Show fewer" : `Show all ${list.length} ${phaseLabel(p)} trials`}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })
      ) : (
        <>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {rows.slice(0, flatLimit).map((t) => <TrialEntry key={t.nct_id} t={t} showPhase />)}
          </ul>
          {rows.length > flatLimit && (
            <button
              type="button"
              onClick={() => setFlatLimit((n) => n + FLAT_PREVIEW)}
              className="w-full border-t border-slate-100 px-5 py-2.5 text-center text-[13px] font-medium text-brand-600 hover:bg-slate-50"
            >
              Show more ({rows.length - flatLimit} left)
            </button>
          )}
        </>
      )}
    </section>
  );
}
