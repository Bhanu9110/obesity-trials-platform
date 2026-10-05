"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FilterOptions, TrialListItem } from "@/lib/types";
import { formatPhase, SPONSOR_GROUPS } from "@/lib/format";
import { Chips, ContinentChips, Dash, NctLink, PhaseText, ProductChips } from "@/components/ui";

const SELECT = "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";

export default function BrowsePage() {
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [phase, setPhase] = useState("");
  const [continent, setContinent] = useState("");
  const [country, setCountry] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [items, setItems] = useState<TrialListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  // Filter choices. A failed request (database hiccup, expired login) must never
  // break the page: retry a few times, and if it still fails the trial list works
  // without the dropdown choices.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/filters");
          if (res.status === 401) { window.location.assign("/login?next=/"); return; }
          const body = await res.json();
          if (res.ok && Array.isArray(body?.phases) && Array.isArray(body?.continents)) {
            if (!cancelled) setOptions(body as FilterOptions);
            return;
          }
        } catch { /* network error: retry */ }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Country dropdown is scoped to the chosen continent.
  const countryChoices = useMemo(() => {
    const all = options?.continents ?? [];
    if (continent) return all.find((c) => c.name === continent)?.countries ?? [];
    return all.flatMap((c) => c.countries).sort((a, b) => a.localeCompare(b));
  }, [options, continent]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (activeQuery) p.set("q", activeQuery);
      if (phase) p.set("phase", phase);
      if (country) p.set("country", country);
      else if (continent) p.set("continent", continent);
      if (sponsor && SPONSOR_GROUPS[sponsor]) p.set("sponsorClass", SPONSOR_GROUPS[sponsor].classes);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      // One automatic retry: the first request after the site has been idle can
      // hit a database connection that has just been closed.
      let r = await fetch(`/api/trials?${p.toString()}`);
      if (r.status >= 500) {
        await new Promise((ok) => setTimeout(ok, 800));
        r = await fetch(`/api/trials?${p.toString()}`);
      }
      if (r.status === 401) { window.location.assign("/login?next=/"); return; }
      const res = await r.json().catch(() => ({ error: `Server answered ${r.status}` }));
      if (res.error) throw new Error(res.error);
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [phase, continent, country, sponsor, activeQuery, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
  }, [phase, continent, country, sponsor, activeQuery]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtersOn = Boolean(activeQuery || phase || continent || country || sponsor);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(queryInput.trim());
        }}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        <input
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search — drug, sponsor, indication, NCT ID…"
          className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-500 sm:min-w-[240px]"
        />
        <select value={phase} onChange={(e) => setPhase(e.target.value)} className={SELECT} title="Phase">
          <option value="">All phases</option>
          {(options?.phases ?? []).map((p) => (
            <option key={p} value={p}>{formatPhase(p)}</option>
          ))}
        </select>
        <select
          value={continent}
          onChange={(e) => {
            setContinent(e.target.value);
            setCountry("");
          }}
          className={SELECT}
          title="Continent"
        >
          <option value="">All continents</option>
          {(options?.continents ?? []).map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={`${SELECT} max-w-[190px]`}
          title={continent ? `Countries in ${continent}` : "Country"}
        >
          <option value="">{continent ? `All of ${continent}` : "All countries"}</option>
          {countryChoices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={sponsor} onChange={(e) => setSponsor(e.target.value)} className={SELECT} title="Sponsor type">
          <option value="">All sponsors</option>
          {Object.entries(SPONSOR_GROUPS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
          Search
        </button>
        {filtersOn && (
          <button
            type="button"
            onClick={() => {
              setQueryInput("");
              setActiveQuery("");
              setPhase("");
              setContinent("");
              setCountry("");
              setSponsor("");
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        )}
      </form>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{loading ? "Loading…" : `${total.toLocaleString()} ${filtersOn ? "matching trials" : "trials"}`}</span>
        <span className="hidden text-xs text-slate-400 sm:inline">
          Click a drug for its product page · click an NCT ID for the full trial details
        </span>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>
            The trial list didn’t load — usually a brief database hiccup.
            <span className="ml-1 text-xs text-amber-700/80" title={error}>({error.slice(0, 80)})</span>
          </span>
          <button type="button" onClick={() => load()} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100">
            Try again
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Trial ID</th>
              <th className="px-4 py-3 font-semibold">Intervention</th>
              <th className="px-4 py-3 font-semibold">Phase</th>
              <th className="px-4 py-3 font-semibold">Sponsor</th>
              <th className="px-4 py-3 font-semibold">Indication</th>
              <th className="px-4 py-3 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No trials match.</td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.nct_id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3"><NctLink id={t.nct_id} /></td>
                  <td className="px-4 py-3"><ProductChips products={t.products} /></td>
                  <td className="px-4 py-3 text-slate-700"><PhaseText phase={t.phase} /></td>
                  <td className="px-4 py-3 text-slate-700">{t.sponsor || <Dash />}</td>
                  <td className="px-4 py-3"><Chips values={t.indication} /></td>
                  <td className="px-4 py-3"><ContinentChips continents={t.continents} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-slate-500">Page {page} of {totalPages.toLocaleString()}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
