"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

// Lightweight SVG/HTML charts for the dark theme. Marks carry colour; text stays
// in text tokens. Every mark has a hover/focus tooltip, and bars can link into
// the Trials explorer with that filter applied.

export { SERIES } from "@/lib/chart-colors";
import { CHART_BRAND } from "@/lib/chart-colors";
const BRAND = CHART_BRAND;

type Tip = { x: number; y: number; title: string; value: string } | null;

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number }, title: string, value: string) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, value });
  };
  const showAt = (el: HTMLElement, title: string, value: string) => {
    const r = ref.current?.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (!r) return;
    setTip({ x: b.left - r.left + b.width / 2, y: b.top - r.top, title, value });
  };
  const box = tip && (
    <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-slate-200 bg-panel px-2.5 py-1.5 shadow-xl"
         style={{ left: tip.x, top: tip.y }}>
      <div className="font-display text-sm font-semibold tabular-nums text-slate-950">{tip.value}</div>
      <div className="text-[11px] text-slate-500">{tip.title}</div>
    </div>
  );
  return { ref, show, showAt, hide: () => setTip(null), box };
}

export interface BarRow { key: string; label: ReactNode; title: string; value: number; href?: string; extra?: ReactNode }

/** Ranked horizontal bars (one series). */
export function BarList({ rows, unit = "trials", color = BRAND, max }: { rows: BarRow[]; unit?: string; color?: string; max?: number }) {
  const t = useTip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div ref={t.ref} className="relative space-y-1" onMouseLeave={t.hide}>
      {rows.map((r) => {
        const pct = Math.max(1.5, (r.value / top) * 100);
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-slate-700 group-hover:text-slate-950">{r.label}</span>
              <span className="shrink-0 font-display font-semibold tabular-nums text-slate-900">{r.value.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100/70">
              <div className="h-2 rounded-r-[4px] rounded-l-full transition-[filter] group-hover:brightness-125"
                   style={{ width: `${pct}%`, background: color, boxShadow: `0 0 12px -2px color-mix(in srgb, ${color} 55%, transparent)` }} />
            </div>
            {r.extra}
          </>
        );
        const cls = "group block rounded-lg px-2 py-1.5 outline-none transition hover:bg-slate-100/40 focus-visible:ring-1 focus-visible:ring-brand-500/50";
        const handlers = {
          onMouseMove: (e: React.MouseEvent) => t.show(e, r.title, `${r.value.toLocaleString()} ${unit}`),
          onFocus: (e: React.FocusEvent<HTMLElement>) => t.showAt(e.currentTarget, r.title, `${r.value.toLocaleString()} ${unit}`),
          onBlur: t.hide,
        };
        return r.href
          ? <Link key={r.key} href={r.href} className={cls} {...handlers}>{body}</Link>
          : <div key={r.key} tabIndex={0} className={cls} {...handlers}>{body}</div>;
      })}
      {t.box}
    </div>
  );
}

/** Columns over years (one series), with clean gridlines and a hover readout. */
export function YearColumns({ data, currentYear, hrefFor, wide = false }: {
  data: { year: number; count: number }[]; currentYear: number; hrefFor?: (year: number) => string; wide?: boolean;
}) {
  const t = useTip();
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No start dates yet.</p>;
  const W = wide ? 1100 : 640, H = 220, padL = 34, padB = 26, padT = 16;
  const maxV = Math.max(...data.map((d) => d.count));
  const step = maxV > 300 ? 100 : maxV > 120 ? 50 : maxV > 60 ? 20 : 10;
  const top = Math.ceil(maxV / step) * step;
  const ticks = [0, top / 2, top];
  const slot = (W - padL) / data.length;
  const bw = Math.min(24, slot * 0.62);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);

  return (
    <div ref={t.ref} className="relative" onMouseLeave={t.hide}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Trials by start year">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="10" className="fill-slate-400">{v.toLocaleString()}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const h = Math.max(2, y(0) - y(d.count));
          const partial = d.year >= currentYear;
          const r = Math.min(4, bw / 2, h);
          const path = `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + bw - r} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r} V${y(0)} Z`;
          const label = d.year > currentYear ? `${d.year} (planned)` : d.year === currentYear ? `${d.year} (so far)` : String(d.year);
          const bar = (
            <g className="cursor-pointer" tabIndex={0}
               onMouseMove={(e) => t.show(e, `Trials starting in ${label}`, `${d.count.toLocaleString()} trials`)}
               onFocus={(e) => t.showAt(e.currentTarget as unknown as HTMLElement, `Trials starting in ${label}`, `${d.count.toLocaleString()} trials`)}
               onBlur={t.hide}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              <path d={path} style={{ fill: BRAND }} opacity={partial ? 0.45 : 0.9} className="transition-opacity hover:opacity-100" />
              {(i % 2 === data.length % 2 || data.length < 10) && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" className="fill-slate-400">{`’${String(d.year).slice(2)}`}</text>
              )}
              {d === peak && (
                <text x={x + bw / 2} y={y(d.count) - 6} textAnchor="middle" fontSize="11" fontWeight="600" className="fill-slate-900">{d.count}</text>
              )}
            </g>
          );
          return hrefFor ? <a key={d.year} href={hrefFor(d.year)}>{bar}</a> : <g key={d.year}>{bar}</g>;
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="stroke-slate-300" strokeWidth="1" />
      </svg>
      {t.box}
    </div>
  );
}

export interface Segment { key: string; label: string; value: number; color: string; href?: string }

/** One 100% bar split into parts, with 2px gaps and a legend that carries the numbers. */
export function SplitBar({ segments, unit = "trials" }: { segments: Segment[]; unit?: string }) {
  const t = useTip();
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div ref={t.ref} className="relative" onMouseLeave={t.hide}>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.key} tabIndex={0} className="h-full cursor-default outline-none transition hover:brightness-125 focus-visible:brightness-125"
               style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: 3 }}
               onMouseMove={(e) => t.show(e, s.label, `${s.value.toLocaleString()} ${unit} · ${Math.round((s.value / total) * 100)}%`)}
               onFocus={(e) => t.showAt(e.currentTarget, s.label, `${s.value.toLocaleString()} ${unit} · ${Math.round((s.value / total) * 100)}%`)}
               onBlur={t.hide} />
        ))}
      </div>
      <ul className="mt-4 space-y-1">
        {segments.map((s) => {
          const inner = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-slate-700 group-hover:text-slate-950">{s.label}</span>
              <span className="font-display font-semibold tabular-nums text-slate-900">{s.value.toLocaleString()}</span>
              <span className="w-10 text-right text-xs tabular-nums text-slate-500">{Math.round((s.value / total) * 100)}%</span>
            </>
          );
          const cls = "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition hover:bg-slate-100/40";
          return <li key={s.key}>{s.href ? <Link href={s.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>;
        })}
      </ul>
      {t.box}
    </div>
  );
}
