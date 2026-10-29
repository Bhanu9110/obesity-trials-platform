"use client";

// The export page: choose Trials or Drugs, the rows (current filters or everything) and the columns,
// see the chosen data as a small dashboard (counts, breakdowns, preview table), then download it as
// Excel, PDF, CSV or Word. Data comes from /api/export (which also checks the download permission).

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarList } from "@/components/charts";
import { formatPhase, SPONSOR_GROUPS, TRIAL_STATUS } from "@/lib/format";
import { STAGE_META, type StageKey } from "@/lib/devStage";
import { FILTER_KEYS, FORMATS, columnsFor, defaultColumns, type ColumnDef, type Dataset, type ExportFormat } from "@/lib/exportColumns";

interface Preview {
  title: string; filters: string[]; columns: ColumnDef[]; rows: (string | number | null)[][];
  summary: { label: string; items: { label: string; value: number }[] }[];
  total: number; truncated: boolean; previewLimit: number; printLimit: number;
}

const PAGE = 50;
const STORE = (d: Dataset) => `ot:export-cols:${d}`;
const loadCols = (d: Dataset): string[] => {
  try { const v = JSON.parse(window.localStorage.getItem(STORE(d)) ?? "null"); return Array.isArray(v) && v.length ? v : defaultColumns(d); }
  catch { return defaultColumns(d); }
};
const saveCols = (d: Dataset, cols: string[]) => { try { window.localStorage.setItem(STORE(d), JSON.stringify(cols)); } catch { /* storage blocked */ } };

export default function ExportBuilder({ initialDataset, filters: pageFilters, canTrials, canDrugs }: {
  initialDataset: Dataset; filters: Record<string, string>; canTrials: boolean; canDrugs: boolean;
}) {
  const [dataset, setDataset] = useState<Dataset>(initialDataset);
  // The list page's filters only belong to the dataset it came from.
  const [fromPage] = useState(initialDataset);
  const hasFilters = dataset === fromPage && FILTER_KEYS[dataset].some((k) => pageFilters[k] && k !== "sort");
  const [scope, setScope] = useState<"filtered" | "all">(hasFilters ? "filtered" : "all");
  const [cols, setCols] = useState<string[]>(() => defaultColumns(initialDataset));
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const loaded = useRef(false);

  // remembered column choice (per dataset, this browser)
  useEffect(() => { setCols(loadCols(dataset)); loaded.current = true; }, [dataset]);
  useEffect(() => { if (loaded.current) saveCols(dataset, cols); }, [dataset, cols]);
  useEffect(() => { if (!hasFilters) setScope("all"); }, [hasFilters]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ type: dataset, scope, cols: cols.join(",") });
    if (scope === "filtered" && dataset === fromPage) for (const k of FILTER_KEYS[dataset]) if (pageFilters[k]) p.set(k, pageFilters[k]);
    return p;
  }, [dataset, scope, cols, pageFilters, fromPage]);

  useEffect(() => {
    if (!cols.length) { setData(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch(`/api/export?${query}&format=json`, { cache: "no-store", signal: ctl.signal });
        const j = await r.json().catch(() => ({ error: `Server answered ${r.status}` }));
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setData(j); setPage(1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
      } finally { setLoading(false); }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, cols.length]);

  async function download(fmt: ExportFormat) {
    setBusy(fmt); setError(null); setDone(null);
    try {
      const r = await fetch(`/api/export?${query}&format=${fmt}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `export.${fmt}`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone(`${name} downloaded`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  const all = columnsFor(dataset);
  const groups = [...new Set(all.map((c) => c.group))];
  const toggle = (k: string) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : all.filter((x) => c.includes(x.key) || x.key === k).map((x) => x.key)));
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const tooBigForPrint = (data?.total ?? 0) > (data?.printLimit ?? Infinity);
  const backHref = dataset === fromPage
    ? `/${dataset}${(() => { const p = new URLSearchParams(); for (const k of FILTER_KEYS[dataset]) if (pageFilters[k]) p.set(k, pageFilters[k]); const s = p.toString(); return s ? `?${s}` : ""; })()}`
    : `/${dataset}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ---------------- choices ---------------- */}
      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Data</h2>
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([["trials", "Trials", canTrials], ["drugs", "Drugs", canDrugs]] as const).map(([k, l, ok]) => (
              <button key={k} type="button" disabled={!ok} onClick={() => setDataset(k)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${dataset === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{l}</button>
            ))}
          </div>
          <h2 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rows</h2>
          <div className="space-y-2 text-sm">
            <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${hasFilters ? "cursor-pointer border-slate-200" : "border-slate-100 opacity-50"} ${scope === "filtered" ? "border-brand-500/50 bg-brand-500/5" : ""}`}>
              <input type="radio" className="mt-1" checked={scope === "filtered"} disabled={!hasFilters} onChange={() => setScope("filtered")} />
              <span>
                <span className="font-medium text-slate-900">With my current filters</span>
                <span className="block text-xs text-slate-500">
                  {hasFilters ? FILTER_KEYS[dataset].filter((k) => pageFilters[k] && k !== "sort").map((k) => filterText(k, pageFilters[k])).join(" · ")
                    : `No filters set on the ${dataset === "trials" ? "Trials" : "Drugs"} page`}
                </span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 ${scope === "all" ? "border-brand-500/50 bg-brand-500/5" : ""}`}>
              <input type="radio" className="mt-1" checked={scope === "all"} onChange={() => setScope("all")} />
              <span>
                <span className="font-medium text-slate-900">Everything</span>
                <span className="block text-xs text-slate-500">{dataset === "trials" ? "Every trial in the database (all obesity relevance classes)" : "Every listed drug"}</span>
              </span>
            </label>
          </div>
          <Link href={backHref} className="mt-3 inline-block text-xs text-brand-600 hover:underline">← Back to the {dataset === "trials" ? "Trials" : "Drugs"} page to change filters</Link>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Columns <span className="normal-case tracking-normal text-slate-400">({cols.length} of {all.length})</span></h2>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setCols(defaultColumns(dataset))}>Default</button>
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setCols(all.map((c) => c.key))}>All</button>
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setCols([])}>None</button>
            </div>
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g}>
                <div className="mb-1 text-xs font-semibold text-slate-700">{g}</div>
                <div className="grid grid-cols-1 gap-0.5">
                  {all.filter((c) => c.group === g).map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-slate-50">
                      <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={cols.includes(c.key)} onChange={() => toggle(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Your choice is remembered in this browser.</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Download</h2>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" title={f.hint} disabled={!cols.length || !data || busy !== null}
                      onClick={() => download(f.key)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm transition hover:border-brand-500/50 hover:bg-brand-500/5 disabled:opacity-50">
                <span className="block font-semibold text-slate-900">{busy === f.key ? "Preparing…" : f.label}</span>
                <span className="block text-[11px] text-slate-500">.{f.key}</span>
              </button>
            ))}
          </div>
          {tooBigForPrint && <p className="mt-2 text-[11px] text-amber-700">PDF and Word show the first {data!.printLimit.toLocaleString()} rows; Excel and CSV have all {data!.total.toLocaleString()}.</p>}
          {done && <p className="mt-2 text-xs text-emerald-700">{done}</p>}
          <p className="mt-2 text-[11px] text-slate-400">Downloads are recorded in the Audit logs.</p>
        </section>
      </aside>

      {/* ---------------- the chosen data ---------------- */}
      <section className="min-w-0 space-y-4">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {!cols.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">Tick at least one column.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label={dataset === "trials" ? "Trials" : "Drugs"} value={data ? data.total.toLocaleString() : "…"} sub={data?.truncated ? "stopped at the export limit" : scope === "all" ? "everything" : "with your filters"} />
              <Tile label="Columns" value={String(cols.length)} sub={`of ${all.length} available`} />
              {(data?.summary ?? []).slice(0, 2).map((s) => {
                const top = s.items[0];
                return <Tile key={s.label} label={s.label.replace(/^By /, "Top ")} value={top ? top.label : "—"} sub={top ? `${top.value.toLocaleString()} ${dataset}` : ""} />;
              })}
            </div>
            {data && data.filters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {data.filters.map((f) => <span key={f} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{f}</span>)}
              </div>
            )}
            {data && (
              <div className="grid gap-3 md:grid-cols-3">
                {data.summary.map((s) => (
                  <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">{s.label}</h3>
                    <BarList unit={dataset} rows={s.items.slice(0, 8).map((i) => ({ key: i.label, label: i.label, title: i.label, value: i.value }))} />
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Preview {loading && <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent align-middle" />}
                </h3>
                {data && (
                  <span className="text-xs text-slate-500">
                    {data.total > rows.length ? `First ${rows.length.toLocaleString()} of ${data.total.toLocaleString()} rows shown — the download has all of them` : `${data.total.toLocaleString()} rows`}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>{(data?.columns ?? []).map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((r, i) => (
                      <tr key={i} className="align-top hover:bg-slate-50/60">
                        {r.map((v, j) => {
                          const c = data!.columns[j];
                          const s = v === null || v === undefined ? "" : String(v);
                          return (
                            <td key={j} className={`px-3 py-2 text-slate-700 ${c.number ? "text-right tabular-nums" : ""}`} style={{ maxWidth: `${Math.round(120 + (c.width ?? 1.5) * 70)}px` }}>
                              {!s ? <span className="text-slate-300">—</span> : c.link ? <a href={s} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 hover:underline">{s.replace(/^https?:\/\//, "")}</a>
                                : <span className="line-clamp-3" title={s}>{s}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {data && !rows.length && <tr><td className="px-3 py-10 text-center text-slate-500" colSpan={data.columns.length}>No rows match.</td></tr>}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-sm">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40">← Prev</button>
                  <span className="text-xs text-slate-500">Page {page} of {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40">Next →</button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** "phase: PHASE2|PHASE3" -> "Phase: Phase 2, Phase 3" (the list page's filter, in words). */
function filterText(k: string, v: string): string {
  const vals = v.split("|");
  switch (k) {
    case "q": return `Search: ${v}`;
    case "phase": return `Phase: ${vals.map(formatPhase).join(", ")}`;
    case "status": return `Status: ${vals.map((x) => TRIAL_STATUS[x]?.label ?? x).join(", ")}`;
    case "sponsor": return `Sponsor: ${SPONSOR_GROUPS[v]?.label ?? v}`;
    case "stage": return `Stage: ${STAGE_META[v as StageKey]?.label ?? v}`;
    case "reg": return `Regulatory status: ${v === "milestone" ? "with an upcoming milestone" : v}`;
    default: return `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${vals.join(", ")}`;
  }
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1.5 truncate font-display text-2xl font-semibold text-slate-950" title={value}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
