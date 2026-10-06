"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { icons, type IconName } from "./icons";
import { formatPhase } from "@/lib/format";

// Global search: Ctrl/⌘ K (or "/") from anywhere. Finds trials (ID, title,
// condition), drugs (name, alias, brand) and sponsors, plus quick page jumps.

export interface PaletteNav { href: string; label: string; icon: IconName }

type Item = { key: string; group: string; label: string; hint?: string; icon: IconName; href: string; mono?: boolean };

interface Results {
  trials: { nct_id: string; title: string | null; phase: string | null; sponsor: string | null }[];
  drugs: { slug: string; name: string; trials: number }[];
  sponsors: { name: string; trials: number }[];
}

export default function CommandPalette({
  open, onClose, nav, canTrials,
}: { open: boolean; onClose: () => void; nav: PaletteNav[]; canTrials: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setRes(null);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setRes(null); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (r.ok) setRes(await r.json());
      } catch { /* aborted */ }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    }, 180);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const pages: Item[] = nav
      .filter((n) => !term || n.label.toLowerCase().includes(term))
      .map((n) => ({ key: `nav:${n.href}`, group: "Go to", label: n.label, icon: n.icon, href: n.href }));
    if (!res) return pages;
    const out: Item[] = [];
    res.drugs.forEach((d) => out.push({
      key: `d:${d.slug}`, group: "Drugs", label: d.name, hint: `${d.trials} trial${d.trials === 1 ? "" : "s"}`,
      icon: "drugs", href: `/drugs/${encodeURIComponent(d.slug)}`,
    }));
    res.trials.forEach((t) => out.push({
      key: `t:${t.nct_id}`, group: "Trials", label: t.title ?? t.nct_id, mono: false,
      hint: [t.nct_id, t.phase ? formatPhase(t.phase) : null, t.sponsor].filter(Boolean).join(" · "),
      icon: "trials", href: `/trials/${t.nct_id}`,
    }));
    if (canTrials) res.sponsors.forEach((s) => out.push({
      key: `s:${s.name}`, group: "Sponsors", label: s.name, hint: `${s.trials} trial${s.trials === 1 ? "" : "s"}`,
      icon: "building", href: `/trials?q=${encodeURIComponent(s.name)}`,
    }));
    if (canTrials && q.trim()) out.push({
      key: "all", group: "Search", label: `Search all trials for “${q.trim()}”`, icon: "search",
      href: `/trials?q=${encodeURIComponent(q.trim())}`,
    });
    return [...out, ...pages];
  }, [res, nav, q, canTrials]);

  useEffect(() => { setActive(0); }, [items.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(it: Item | undefined) {
    if (!it) return;
    onClose();
    router.push(it.href);
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-pop"
           onKeyDown={(e) => {
             if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
             else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
             else if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
             else if (e.key === "Escape") { e.preventDefault(); onClose(); }
           }}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <span className="text-brand-600">{icons.search}</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search trials, drugs, sponsors, NCT IDs…"
                 className="h-14 flex-1 !border-0 !bg-transparent text-[15px] !shadow-none outline-none" />
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />}
          <kbd className="rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-slate-500">{loading ? "Searching…" : "Nothing found."}</p>
          ) : items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {header && <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{header}</div>}
                <button type="button" data-idx={i} onMouseMove={() => setActive(i)} onClick={() => go(it)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          i === active ? "bg-brand-500/10 ring-1 ring-brand-500/30" : "hover:bg-slate-100/50"}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ${
                    i === active ? "bg-brand-500/15 text-brand-600 ring-brand-500/30" : "bg-slate-100/70 text-slate-500 ring-slate-200"}`}>
                    {icons[it.icon]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900">{it.label}</span>
                    {it.hint && <span className="block truncate text-xs text-slate-500">{it.hint}</span>}
                  </span>
                  {i === active && <span className="text-brand-600">{icons.arrowRight}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
          <span><kbd className="font-mono">↑↓</kbd> move</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
          <span className="ml-auto">Search covers trial IDs, titles, conditions, drugs, brands and sponsors</span>
        </div>
      </div>
    </div>
  );
}
