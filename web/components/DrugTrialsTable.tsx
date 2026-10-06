"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProductTrial } from "@/lib/types";
import {
  CONTINENT_ORDER, OBESITY_CLASSES, OBESITY_CLASS_ORDER, TRIAL_STATUS_ORDER, formatMonthYear, formatPhase,
  phaseRank, sortContinents, statusInfo, trialUrl,
} from "@/lib/format";

// Trials of one drug: a clickable phase bar, a summary line, one toolbar, and a
// table of trials grouped by phase. Columns line up (Trial = "NCT ID – title" ·
// Sponsor · Status · Start · Participants · Region) and every column header sorts; the active sort
// is marked with an arrow, so the order is always visible.

const NO_PHASE = "__none__";
const ACTIVE = "__active__";
const SELECT = "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700";
const GROUP_PREVIEW = 10;  // trials shown per phase group before "Show all"
const FLAT_PREVIEW = 50;   // trials shown in the ungrouped list before "Show more"

type SortKey = "title" | "sponsor" | "status" | "start" | "enrollment" | "region";
type SponsorFilter = "" | "industry" | "academic";

const phaseKey = (t: ProductTrial) => t.phase || NO_PHASE;
const phaseLabel = (p: string) => (p === NO_PHASE ? "No phase" : formatPhase(p));
const rankOf = (p: string) => phaseRank(p === NO_PHASE ? null : p);
const isIndustry = (t: ProductTrial) => t.lead_sponsor_class === "INDUSTRY";

/** Phase-strip colour: the same phase colours as the phase pills everywhere else. */
function phaseColour(p: string): string {
  const u = p.toUpperCase();
  if (u.includes("PHASE4")) return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  if (u.includes("PHASE3")) return "bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200";
  if (u.includes("PHASE2")) return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  if (u.includes("PHASE1")) return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
}

const CONTINENT_SHORT: Record<string, string> = {
  "North America": "N. America", "South America": "S. America", Europe: "Europe", Asia: "Asia",
  Africa: "Africa", Oceania: "Oceania", Other: "Other",
};

// Column layout shared by the header and every row (md and up). On phones each
// row stacks instead.
const GRID = "md:grid md:grid-cols-[minmax(0,1fr)_180px_150px_84px_96px_110px] md:items-center md:gap-x-4";

const COLUMNS: { key: SortKey; label: string; align?: "right"; first: "asc" | "desc" }[] = [
  { key: "title", label: "Trial", first: "asc" },
  { key: "sponsor", label: "Sponsor", first: "asc" },
  { key: "status", label: "Status", first: "asc" },
  { key: "start", label: "Start", first: "desc" },
  { key: "enrollment", label: "Participants", align: "right", first: "desc" },
  { key: "region", label: "Region", first: "asc" },
];

/** Comparator for one column; missing values always go last. */
function compare(key: SortKey, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const val = (t: ProductTrial): string | number | null => {
    switch (key) {
      case "title": return t.title?.toLowerCase() ?? null;
      case "sponsor": return t.sponsor?.toLowerCase() ?? null;
      case "status": { const i = TRIAL_STATUS_ORDER.indexOf(t.overall_status ?? ""); return t.overall_status ? (i < 0 ? 99 : i) : null; }
      case "start": return t.start_date ?? null;
      case "enrollment": return t.enrollment ?? null;
      case "region": return t.continents.length ? sortContinents(t.continents).map((c) => CONTINENT_ORDER.indexOf(c)).join(",") : null;
    }
  };
  return (a: ProductTrial, b: ProductTrial) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * sign;
  };
}

function StatusBadge({ s }: { s: string | null }) {
  const info = statusInfo(s);
  if (!info) return <span className="text-xs text-slate-300">—</span>;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${info.badge}`}>{info.label}</span>;
}

function TrialRow({ t }: { t: ProductTrial }) {
  const start = formatMonthYear(t.start_date);
  const region = sortContinents(t.continents).map((c) => CONTINENT_SHORT[c] ?? c).join(", ");
  return (
    <li>
      <Link href={trialUrl(t.nct_id)} className={`group block px-5 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${GRID}`}>
        {/* Trial: "NCT ID – title". The NCT ID sits in a fixed-width slot so every
            title — and every wrapped second line — starts at the same position. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="w-[112px] shrink-0 whitespace-nowrap font-mono text-[13px] font-medium text-brand-600">
            {t.nct_id}<span className="font-sans text-slate-400"> –</span>
          </span>
          <span className="line-clamp-2 min-w-0 text-[14px] font-medium leading-snug text-slate-900 group-hover:text-brand-700" title={t.title ?? undefined}>
            {t.title || <span className="font-normal italic text-slate-400">title appears after the next sync</span>}
          </span>
        </div>
        {/* Phones: the other columns as one compact line */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 md:hidden">
          <StatusBadge s={t.overall_status} />
          <span>{t.sponsor ?? "—"}{isIndustry(t) && <span className="ml-1 font-semibold text-indigo-700">· Industry</span>}</span>
          {start && <span>{start}</span>}
          {t.enrollment != null && <span>{t.enrollment.toLocaleString()} pts</span>}
          {region && <span>{region}</span>}
        </div>
        {/* md and up: aligned columns */}
        <div className="hidden min-w-0 text-[13px] text-slate-700 md:block">
          <div className="truncate" title={t.sponsor ?? undefined}>{t.sponsor ?? <span className="text-slate-300">—</span>}</div>
          {isIndustry(t) && <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Industry</span>}
        </div>
        <div className="hidden md:block"><StatusBadge s={t.overall_status} /></div>
        <div className="hidden text-[13px] tabular-nums text-slate-700 md:block">{start ?? <span className="text-slate-300">—</span>}</div>
        <div className="hidden text-right text-[13px] tabular-nums text-slate-700 md:block">
          {t.enrollment != null ? t.enrollment.toLocaleString() : <span className="text-slate-300">—</span>}
        </div>
        <div className="hidden truncate text-[13px] text-slate-600 md:block" title={region}>{region || <span className="text-slate-300">—</span>}</div>
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
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [grouped, setGrouped] = useState(true);
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
    const byCol = compare(sortKey, sortDir);
    // Ties: newest start first, then newest registration.
    const tie = (a: ProductTrial, b: ProductTrial) => compare("start", "desc")(a, b) || b.nct_id.localeCompare(a.nct_id);
    return r.sort((a, b) => byCol(a, b) || tie(a, b));
  }, [base, phase, sortKey, sortDir]);

  const sortBy = (key: SortKey) => {
    const col = COLUMNS.find((c) => c.key === key)!;
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(col.first); }
    setFlatLimit(FLAT_PREVIEW);
  };

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
    if (!grouped) return null;
    const g = new Map<string, ProductTrial[]>();
    for (const t of rows) g.set(phaseKey(t), [...(g.get(phaseKey(t)) ?? []), t]);
    return [...g.entries()].sort((a, b) => rankOf(b[0]) - rankOf(a[0])); // latest phase first
  }, [rows, grouped]);

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
              className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 lg:min-w-[260px]"
            />
            {industryTotal > 0 && industryTotal < scoped.length && (
              <div className="flex w-full overflow-hidden rounded-xl border border-slate-200 text-sm lg:w-auto" role="group" aria-label="Sponsor type">
                {([["", "All sponsors"], ["industry", `Industry (${industryTotal})`], ["academic", "Non-industry"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSponsor(v)}
                    aria-pressed={sponsor === v}
                    className={`flex-1 whitespace-nowrap px-2 py-2 text-xs sm:px-3 sm:text-sm lg:flex-none ${sponsor === v ? "bg-brand-500/15 font-medium text-brand-700" : "bg-white text-slate-600 hover:text-slate-900"}`}
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
              <select
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => { const [k, d] = e.target.value.split(":"); setSortKey(k as SortKey); setSortDir(d as "asc" | "desc"); }}
                className={`${SELECT} md:hidden`}
                title="Sort"
              >
                <option value="start:desc">Newest start first</option>
                <option value="start:asc">Oldest start first</option>
                <option value="status:asc">Recruiting first</option>
                <option value="enrollment:desc">Most participants</option>
                <option value="sponsor:asc">Sponsor A–Z</option>
              </select>
              <label className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <input type="checkbox" checked={grouped} onChange={(e) => { setGrouped(e.target.checked); setFlatLimit(FLAT_PREVIEW); }} />
                Group by phase
              </label>
              {filtered && (
                <button type="button" onClick={clear} className="rounded-lg px-3 py-2 text-sm text-brand-600 hover:bg-slate-50">
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className={`hidden border-b border-slate-200 bg-white px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${GRID}`} role="row">
          {COLUMNS.map((c) => {
            const on = sortKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => sortBy(c.key)}
                title={`Sort by ${c.label.toLowerCase()}`}
                aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                className={`flex items-center gap-1 uppercase hover:text-slate-900 ${c.align === "right" ? "justify-end" : ""} ${on ? "text-slate-900" : ""}`}
              >
                {c.label}
                <span aria-hidden className={on ? "text-brand-600" : "text-slate-300"}>{on ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
              </button>
            );
          })}
        </div>
      )}

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
                className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <span aria-hidden className={`text-slate-400 transition ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                {phaseLabel(p)}
                <span className="font-normal text-slate-400">{list.length} trial{list.length === 1 ? "" : "s"}</span>
              </button>
              {!isCollapsed && (
                <>
                  <ul className="divide-y divide-slate-100 border-b border-slate-100">
                    {shown.map((t) => <TrialRow key={t.nct_id} t={t} />)}
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
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, flatLimit).map((t) => <TrialRow key={t.nct_id} t={t} />)}
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
