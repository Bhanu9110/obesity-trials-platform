"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TrialPreview as Preview } from "@/lib/queries";
import { formatMonthYear } from "@/lib/format";
import { Chips, ContinentChips, PhaseText, ProductChips, StatusPill } from "@/components/ui";
import { icons } from "@/components/shell/icons";

/** Slide-over quick look at one trial. ↑/↓ (or J/K) move through the list, Esc closes. */
export default function TrialPreview({
  nct, onClose, onPrev, onNext,
}: { nct: string | null; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!nct) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setCopied(false);
    fetch(`/api/trials/${nct}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
        if (!cancelled) setData(b);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [nct]);

  useEffect(() => {
    if (!nct) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "Escape") onClose();
      else if ((e.key === "ArrowDown" || e.key === "j") && onNext) { e.preventDefault(); onNext(); }
      else if ((e.key === "ArrowUp" || e.key === "k") && onPrev) { e.preventDefault(); onPrev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nct, onClose, onNext, onPrev]);

  if (!nct) return null;

  const fact = (label: string, value: React.ReactNode, icon: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>{label}
      </div>
      <div className="mt-1 font-display text-sm font-semibold text-slate-900">{value || <span className="text-slate-400">—</span>}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Trial ${nct}`}>
      <div className="absolute inset-0 bg-[rgb(3_6_14/0.55)] backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-[rgb(8_13_28/0.97)] shadow-[0_0_80px_-10px_rgb(0_0_0/0.9)] animate-[fade-up_.25s_ease-out]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-700 ring-1 ring-brand-200">{nct}</span>
          <span className="text-xs text-slate-500">Quick preview</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={onPrev} disabled={!onPrev} title="Previous (↑)" className="rounded-lg p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30">
              <span className="block rotate-90">{icons.chevronLeft}</span>
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} title="Next (↓)" className="rounded-lg p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30">
              <span className="block -rotate-90">{icons.chevronLeft}</span>
            </button>
            <button type="button" onClick={onClose} title="Close (Esc)" className="rounded-lg p-1.5 text-slate-500 hover:text-slate-900">{icons.close}</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          ) : !data ? (
            <div className="space-y-3">
              {[90, 70, 100, 40, 80].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />)}
              <div className="grid grid-cols-2 gap-2 pt-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <StatusPill status={data.overall_status} />
                  <PhaseText phase={data.phase} />
                </div>
                <h2 className="font-display text-xl font-semibold leading-snug text-slate-950">{data.title ?? data.nct_id}</h2>
                {data.official_title && data.official_title !== data.title && (
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{data.official_title}</p>
                )}
                <p className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-slate-400">{icons.building}</span>{data.sponsor ?? "—"}
                  {data.lead_sponsor_class === "INDUSTRY" && <span className="rounded bg-sky-50 px-1 text-[10px] font-semibold uppercase text-sky-700">industry</span>}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {fact("Start", formatMonthYear(data.start_date), icons.calendar)}
                {fact("Primary completion", formatMonthYear(data.primary_completion), icons.clock)}
                {fact("Enrollment", data.enrollment != null ? `${data.enrollment.toLocaleString()} participants` : null, icons.users)}
                {fact("Study completion", formatMonthYear(data.completion), icons.rocket)}
              </div>

              <Section title="Drugs"><ProductChips products={data.products} max={12} /></Section>
              <Section title="Conditions"><Chips values={data.conditions} max={12} /></Section>
              <Section title="Locations">
                <ContinentChips continents={data.continents} />
                {data.countries.length > 0 && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    {data.countries.slice(0, 14).join(", ")}{data.countries.length > 14 ? ` and ${data.countries.length - 14} more` : ""}
                  </p>
                )}
              </Section>
              {data.summary && (
                <Section title="Summary">
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600">
                    {data.summary.length >= 900 ? `${data.summary.trim()}…` : data.summary}
                  </p>
                </Section>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
          <Link href={`/trials/${nct}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm text-white">
            Open full trial page {icons.arrowRight}
          </Link>
          <button type="button" title="Copy trial ID"
                  onClick={async () => { try { await navigator.clipboard.writeText(nct); setCopied(true); } catch { /* ignore */ } }}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:text-slate-950">
            {icons.copy}{copied ? "Copied" : "ID"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      {children}
    </div>
  );
}
