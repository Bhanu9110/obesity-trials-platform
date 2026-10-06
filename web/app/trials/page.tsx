"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FilterOptions, TrialListItem } from "@/lib/types";
import { SPONSOR_GROUPS, TRIAL_STATUS, TRIAL_STATUS_ORDER, formatMonthYear, formatPhase } from "@/lib/format";
import { phaseIndex } from "@/lib/chart-colors";
import { ContinentChips, Dash, PhaseText, ProductChips, StatusPill } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import TrialPreview from "@/components/TrialPreview";
import { icons } from "@/components/shell/icons";

// Trials explorer: filters on the left, results on the right, a quick-preview
// panel on row click. Every filter lives in the URL, so a view can be shared.

const SORTS: Record<string, string> = {
  newest: "Newest registered",
  start_desc: "Start date — latest",
  start_asc: "Start date — earliest",
  phase: "Most advanced phase",
  enrollment: "Largest enrollment",
  sponsor: "Sponsor A–Z",
};
const PAGE_SIZES = [25, 50, 100];
const split = (v: string | null) => (v ? v.split("|").filter(Boolean) : []);

function Explorer() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // ---- URL state ----
  const q = sp.get("q") ?? "";
  const phases = split(sp.get("phase"));
  const statuses = split(sp.get("status"));
  const sponsor = sp.get("sponsor") ?? "";
  const continent = sp.get("continent") ?? "";
  const country = sp.get("country") ?? "";
  const sort = SORTS[sp.get("sort") ?? ""] ? sp.get("sort")! : "newest";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = PAGE_SIZES.includes(Number(sp.get("size"))) ? Number(sp.get("size")) : 25;

  const setParams = useCallback((patch: Record<string, string | string[] | number | null>, keepPage = false) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      const val = Array.isArray(v) ? v.join("|") : v === null ? "" : String(v);
      if (val) p.set(k, val); else p.delete(k);
    }
    if (!keepPage && !("page" in patch)) p.delete("page");
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // ---- data ----
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [items, setItems] = useState<TrialListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState(q);
  const [preview, setPreview] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQueryInput(q); }, [q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/filters");
          if (res.status === 401) { window.location.assign("/login?next=/trials"); return; }
          const body = await res.json();
          if (res.ok && Array.isArray(body?.phases)) { if (!cancelled) setOptions(body); return; }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (phases.length) p.set("phase", phases.join("|"));
    if (statuses.length) p.set("status", statuses.join("|"));
    if (country) p.set("country", country); else if (continent) p.set("continent", continent);
    if (sponsor && SPONSOR_GROUPS[sponsor]) p.set("sponsorClass", SPONSOR_GROUPS[sponsor].classes);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("pageSize", String(size));
    return p.toString();
  }, [q, phases, statuses, country, continent, sponsor, sort, page, size]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let r = await fetch(`/api/trials?${apiQuery}`);
      if (r.status >= 500) { await new Promise((ok) => setTimeout(ok, 800)); r = await fetch(`/api/trials?${apiQuery}`); }
      if (r.status === 401) { window.location.assign(`/login?next=${encodeURIComponent("/trials")}`); return; }
      const res = await r.json().catch(() => ({ error: `Server answered ${r.status}` }));
      if (!r.ok || !Array.isArray(res.items)) throw new Error(res.error ?? `HTTP ${r.status}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [apiQuery]);
  useEffect(() => { load(); }, [load]);

  // "/" focuses the search box on this page (the global palette uses Ctrl/⌘ K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };
  const totalPages = Math.max(1, Math.ceil(total / size));

  // ---- facet choices ----
  const facets = options?.facets;
  const phaseChoices = useMemo(() => (options?.phases ?? []).slice().sort((a, b) => phaseIndex(a) - phaseIndex(b)), [options]);
  const statusChoices = useMemo(() => {
    const present = Object.keys(facets?.statuses ?? {}).filter(Boolean);
    return TRIAL_STATUS_ORDER.filter((s) => present.includes(s)).concat(present.filter((s) => !TRIAL_STATUS[s]));
  }, [facets]);
  const sponsorCount = (key: string) =>
    SPONSOR_GROUPS[key].classes.split(",").reduce((a, c) => a + (facets?.sponsorClasses?.[c] ?? 0), 0);
  const countryChoices = useMemo(() => {
    const all = options?.continents ?? [];
    if (continent) return all.find((c) => c.name === continent)?.countries ?? [];
    return all.flatMap((c) => c.countries).sort((a, b) => a.localeCompare(b));
  }, [options, continent]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(q ? [{ key: "q", label: `“${q}”`, clear: () => setParams({ q: null }) }] : []),
    ...phases.map((p) => ({ key: `p${p}`, label: formatPhase(p), clear: () => setParams({ phase: phases.filter((x) => x !== p) }) })),
    ...statuses.map((s) => ({ key: `s${s}`, label: TRIAL_STATUS[s]?.label ?? s, clear: () => setParams({ status: statuses.filter((x) => x !== s) }) })),
    ...(sponsor && SPONSOR_GROUPS[sponsor] ? [{ key: "sp", label: SPONSOR_GROUPS[sponsor].label, clear: () => setParams({ sponsor: null }) }] : []),
    ...(continent ? [{ key: "c", label: continent, clear: () => setParams({ continent: null, country: null }) }] : []),
    ...(country ? [{ key: "co", label: country, clear: () => setParams({ country: null }) }] : []),
  ];

  const idx = preview ? items.findIndex((t) => t.nct_id === preview) : -1;

  const panel = (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); setParams({ q: queryInput.trim() || null }); }}>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Keyword</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
          <input ref={searchRef} value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
                 placeholder="Drug, sponsor, condition, NCT…"
                 className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none" />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">Press Enter to search · <kbd className="font-mono">F</kbd> to jump here</p>
      </form>

      <Facet title="Phase">
        {phaseChoices.map((p) => (
          <Check key={p} checked={phases.includes(p)} onChange={() => setParams({ phase: toggle(phases, p) })}
                 label={formatPhase(p)} count={facets?.phases?.[p]} />
        ))}
      </Facet>

      <Facet title="Recruitment status">
        {statusChoices.map((s) => (
          <Check key={s} checked={statuses.includes(s)} onChange={() => setParams({ status: toggle(statuses, s) })}
                 label={TRIAL_STATUS[s]?.label ?? s} count={facets?.statuses?.[s]} />
        ))}
      </Facet>

      <Facet title="Sponsor type">
        {[["", "Any sponsor"], ...Object.entries(SPONSOR_GROUPS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <label key={k || "any"} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100/40">
            <input type="radio" name="sponsor" checked={sponsor === k} onChange={() => setParams({ sponsor: k || null })} className="h-3.5 w-3.5" />
            <span className="flex-1">{label}</span>
            {k && facets && <span className="text-xs tabular-nums text-slate-400">{sponsorCount(k).toLocaleString()}</span>}
          </label>
        ))}
      </Facet>

      <Facet title="Location">
        <select value={continent} onChange={(e) => setParams({ continent: e.target.value || null, country: null })}
                className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">All regions</option>
          {(options?.continents ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select value={country} onChange={(e) => setParams({ country: e.target.value || null })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">{continent ? `All countries in ${continent}` : "All countries"}</option>
          {countryChoices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Facet>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Trials explorer"
        title="Search the"
        highlight="trial universe"
        description="Filter by phase, status, sponsor and region. Click a row for a quick preview; every view has a shareable link."
        actions={
          <button type="button"
                  onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); flash("Link to this view copied"); } catch { flash("Copy failed"); } }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950">
            {icons.link} Share this view
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
        {/* Filters */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 font-display text-sm font-semibold text-slate-950">{icons.filter} Filters</span>
              {chips.length > 0 && (
                <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  Reset all
                </button>
              )}
            </div>
            <div className="max-h-[calc(100vh-11rem)] overflow-y-auto pr-1">{panel}</div>
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setFiltersOpen(true)}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 lg:hidden">
              {icons.filter} Filters{chips.length ? ` (${chips.length})` : ""}
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /> : null}
              <span><b className="font-display text-lg font-semibold text-slate-950">{loading && !total ? "…" : total.toLocaleString()}</b> trials</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="hidden sm:inline">{icons.sort}</span>
                <select value={sort} onChange={(e) => setParams({ sort: e.target.value === "newest" ? null : e.target.value })}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <select value={size} onChange={(e) => setParams({ size: Number(e.target.value) === 25 ? null : Number(e.target.value) })}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" title="Rows per page">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button key={c.key} type="button" onClick={c.clear}
                        className="group flex items-center gap-1.5 rounded-full bg-brand-500/10 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 ring-1 ring-brand-500/30 transition hover:bg-brand-500/20">
                  {c.label}
                  <span className="grid h-4 w-4 place-items-center rounded-full text-brand-600 group-hover:bg-brand-500/20">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </span>
                </button>
              ))}
              <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="px-2 text-xs text-slate-500 hover:text-slate-900">
                Clear all
              </button>
            </div>
          )}

          {error && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="min-w-0 flex-1">{error.includes("DATABASE_URL") ? error : <>The trial list didn&apos;t load — usually a brief database hiccup. <span className="text-xs opacity-80">({error.slice(0, 80)})</span></>}</span>
              <button type="button" onClick={() => load()} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-amber-800 ring-1 ring-amber-300">Try again</button>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Trial</th>
                  <th className="px-3 py-3 font-semibold">Drugs</th>
                  <th className="px-3 py-3 font-semibold">Phase</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Sponsor</th>
                  <th className="px-3 py-3 font-semibold">Start</th>
                  <th className="px-3 py-3 text-right font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Regions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && items.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {[60, 18, 10, 12, 18, 8, 6, 12].map((w, j) => (
                        <td key={j} className="px-4 py-4"><div className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${w * 4}px`, maxWidth: "100%" }} /></td>
                      ))}
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-16 text-center">
                    <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icons.search}</div>
                    <div className="font-display text-base font-semibold text-slate-900">No trials match these filters</div>
                    <p className="mt-1 text-sm text-slate-500">Remove a filter or try a broader keyword.</p>
                  </td></tr>
                ) : items.map((t) => (
                  <tr key={t.nct_id} tabIndex={0}
                      onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) setPreview(t.nct_id); }}
                      onKeyDown={(e) => { if (e.key === "Enter") setPreview(t.nct_id); }}
                      className={`cursor-pointer align-top outline-none transition focus-visible:bg-brand-500/5 ${preview === t.nct_id ? "!bg-brand-500/[0.07]" : ""} ${loading ? "opacity-60" : ""}`}>
                    <td className="max-w-[380px] px-4 py-3">
                      <Link href={`/trials/${t.nct_id}`} className="font-mono text-xs font-medium text-brand-600 hover:text-brand-700">{t.nct_id}</Link>
                      <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-slate-800" title={t.title ?? undefined}>
                        {t.title ?? <span className="italic text-slate-400">Title appears after the next sync</span>}
                      </div>
                    </td>
                    <td className="max-w-[180px] px-3 py-3"><ProductChips products={t.products} max={3} /></td>
                    <td className="px-3 py-3"><PhaseText phase={t.phase} /></td>
                    <td className="px-3 py-3"><StatusPill status={t.overall_status} compact /></td>
                    <td className="max-w-[200px] px-3 py-3 text-[13px] text-slate-700">
                      <span className="line-clamp-2">{t.sponsor || <Dash />}</span>
                      {t.lead_sponsor_class === "INDUSTRY" && <span className="mt-0.5 inline-block rounded bg-sky-50 px-1 text-[10px] font-semibold uppercase text-sky-700">industry</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] tabular-nums text-slate-600">{formatMonthYear(t.start_date) ?? <Dash />}</td>
                    <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-600">{t.enrollment != null ? t.enrollment.toLocaleString() : <Dash />}</td>
                    <td className="px-4 py-3"><ContinentChips continents={t.continents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <Pager page={page} totalPages={totalPages} onPage={(p) => { setParams({ page: p === 1 ? null : p }, true); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          )}
          <p className="px-1 text-xs text-slate-400">Tip: click a row for a quick preview, or press <kbd className="font-mono">Ctrl/⌘ K</kbd> to search everything.</p>
        </div>
      </div>

      {/* Mobile filters */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[rgb(3_6_14/0.7)] backdrop-blur-sm" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[310px] overflow-y-auto border-r border-slate-200 bg-[rgb(8_13_28)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display font-semibold text-slate-950">Filters</span>
              <button type="button" onClick={() => setFiltersOpen(false)} className="rounded-lg p-1.5 text-slate-500">{icons.close}</button>
            </div>
            {panel}
          </div>
        </div>
      )}

      <TrialPreview
        nct={preview}
        onClose={() => setPreview(null)}
        onPrev={idx > 0 ? () => setPreview(items[idx - 1].nct_id) : undefined}
        onNext={idx >= 0 && idx < items.length - 1 ? () => setPreview(items[idx + 1].nct_id) : undefined}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 animate-fade-up rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-100/40 ${checked ? "text-slate-950" : "text-slate-700"}`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 rounded" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-slate-400">{count.toLocaleString()}</span>}
    </label>
  );
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  const nums = Array.from(new Set([1, page - 1, page, page + 1, totalPages])).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const btn = "grid h-9 min-w-9 place-items-center rounded-xl px-3 text-sm transition disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:border-brand-500/50`}>← Prev</button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
          <button type="button" onClick={() => onPage(n)}
                  className={`${btn} ${n === page ? "bg-brand-500/15 font-semibold text-brand-700 ring-1 ring-brand-500/40" : "border border-slate-200 bg-white text-slate-600 hover:border-brand-500/50"}`}>
            {n.toLocaleString()}
          </button>
        </span>
      ))}
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:border-brand-500/50`}>Next →</button>
    </div>
  );
}

export default function TrialsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-slate-500">Loading explorer…</div>}>
      <Explorer />
    </Suspense>
  );
}
