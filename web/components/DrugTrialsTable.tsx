"use client";

import { useMemo, useState } from "react";
import type { ProductTrial } from "@/lib/types";
import { CONTINENT_ORDER, formatPhase, phaseRank, OBESITY_CLASSES, OBESITY_CLASS_ORDER } from "@/lib/format";
import { Chips, ContinentChips, Dash, NctLink, PhaseText } from "@/components/ui";

const NO_PHASE = "__none__";
const SELECT = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

/** Trials of one drug, with a search box and phase / continent filters. */
export default function DrugTrialsTable({ trials: allTrials }: { trials: ProductTrial[] }) {
  const classCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of allTrials) m[t.obesity_class] = (m[t.obesity_class] ?? 0) + 1;
    return m;
  }, [allTrials]);
  // Primary-obesity trials by default (all of them if the drug has none).
  const [scope, setScope] = useState(() => (allTrials.some((t) => t.obesity_class === "primary") ? "primary" : "all"));
  const trials = useMemo(
    () => (scope === "all" ? allTrials : allTrials.filter((t) => t.obesity_class === scope)),
    [allTrials, scope],
  );
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState("");
  const [continent, setContinent] = useState("");

  // Phase options with counts, latest stage first.
  const phaseCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trials) {
      const k = t.phase || NO_PHASE;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort(
      (a, b) => phaseRank(b[0] === NO_PHASE ? null : b[0]) - phaseRank(a[0] === NO_PHASE ? null : a[0]),
    );
  }, [trials]);

  const continents = useMemo(() => {
    const s = new Set(trials.flatMap((t) => t.continents));
    return CONTINENT_ORDER.filter((c) => s.has(c));
  }, [trials]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return trials.filter((t) => {
      if (phase && (t.phase || NO_PHASE) !== phase) return false;
      if (continent && !t.continents.includes(continent)) return false;
      if (!needle) return true;
      return (
        t.nct_id.toLowerCase().includes(needle) ||
        (t.sponsor ?? "").toLowerCase().includes(needle) ||
        t.indication.some((i) => i.toLowerCase().includes(needle))
      );
    });
  }, [trials, q, phase, continent]);

  const filtered = Boolean(q.trim() || phase || continent);
  const label = (p: string) => (p === NO_PHASE ? "No phase" : formatPhase(p));

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="space-y-3 border-b border-slate-100 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Trials ({filtered ? `${rows.length} of ${trials.length}` : trials.length})
          </h2>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {phaseCounts.map(([p, n]) => (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(phase === p ? "" : p)}
                title={phase === p ? "Show all phases" : `Show only ${label(p)}`}
                className={`rounded-full px-2 py-0.5 ${
                  phase === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label(p)}: {n}
              </button>
            ))}
          </div>
        </div>

        {allTrials.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a trial — NCT ID, sponsor or indication…"
              className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 sm:min-w-[260px]"
            />
            <select value={phase} onChange={(e) => setPhase(e.target.value)} className={SELECT} title="Phase">
              <option value="">All phases</option>
              {phaseCounts.map(([p, n]) => (
                <option key={p} value={p}>{label(p)} ({n})</option>
              ))}
            </select>
            {Object.keys(classCounts).length > 1 && (
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPhase("");
                }}
                className={`${SELECT} ${scope !== "primary" ? "border-amber-400 bg-amber-50" : ""}`}
                title="Primary-obesity trials, or the other stored trials"
              >
                {OBESITY_CLASS_ORDER.filter((k) => classCounts[k]).map((k) => (
                  <option key={k} value={k}>{OBESITY_CLASSES[k].label} ({classCounts[k]})</option>
                ))}
                <option value="all">All stored trials ({allTrials.length})</option>
              </select>
            )}
            <select value={continent} onChange={(e) => setContinent(e.target.value)} className={SELECT} title="Continent">
              <option value="">All continents</option>
              {continents.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setPhase("");
                  setContinent("");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Trial ID</th>
              <th className="px-5 py-2.5 font-semibold">Phase</th>
              <th className="px-5 py-2.5 font-semibold">Sponsor</th>
              <th className="px-5 py-2.5 font-semibold">Indication</th>
              <th className="px-5 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                  {trials.length === 0 ? "No active trials currently linked to this drug." : "No trials match these filters."}
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.nct_id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-2.5"><NctLink id={t.nct_id} /></td>
                  <td className="px-5 py-2.5 text-slate-700"><PhaseText phase={t.phase} /></td>
                  <td className="px-5 py-2.5 text-slate-700">{t.sponsor || <Dash />}</td>
                  <td className="px-5 py-2.5">
                    {t.obesity_class !== "primary" && OBESITY_CLASSES[t.obesity_class] && (
                      <span title={t.obesity_reason ?? undefined}
                            className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${OBESITY_CLASSES[t.obesity_class].badge}`}>
                        {OBESITY_CLASSES[t.obesity_class].short}
                      </span>
                    )}
                    <Chips values={t.indication} />
                  </td>
                  <td className="px-5 py-2.5"><ContinentChips continents={t.continents} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
