import type { ReactNode } from "react";

/**
 * Page title block used on every page: a small glowing label, a large title
 * (optionally with a gradient highlight), a short description and actions.
 */
export default function PageHeader({
  eyebrow, title, highlight, description, actions, children,
}: {
  eyebrow?: string;
  title: ReactNode;
  highlight?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && (
            <div className="eyebrow mb-2 flex items-center gap-2">
              <span className="h-px w-6 bg-gradient-to-r from-transparent to-brand-500" />
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-slate-950 md:text-[34px]">
            {title} {highlight && <span className="text-gradient">{highlight}</span>}
          </h1>
          {description && <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const TONE = {
  cyan: { text: "text-brand-600", line: "from-brand-500/80", glow: "bg-brand-500/20" },
  violet: { text: "text-accent-600", line: "from-accent-500/80", glow: "bg-accent-500/20" },
  emerald: { text: "text-emerald-600", line: "from-emerald-400/80", glow: "bg-emerald-400/20" },
  amber: { text: "text-amber-600", line: "from-amber-400/80", glow: "bg-amber-400/20" },
  pink: { text: "text-pink-600", line: "from-pink-400/80", glow: "bg-pink-400/20" },
  sky: { text: "text-sky-600", line: "from-sky-400/80", glow: "bg-sky-400/20" },
} as const;
export type Tone = keyof typeof TONE;

/** A glass tile with one big number. */
export function StatTile({
  label, value, sub, tone = "cyan", icon,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  const t = TONE[tone];
  return (
    <div className="glass group relative overflow-hidden rounded-2xl p-4 transition hover:-translate-y-0.5">
      <span className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${t.line} to-transparent`} />
      <span className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl ${t.glow} opacity-60 transition group-hover:opacity-100`} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
        {icon && <span className={`${t.text} opacity-80`}>{icon}</span>}
      </div>
      <div className={`mt-2 font-display text-[28px] font-semibold leading-none tabular-nums ${t.text}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Small line icons (stroke follows the text colour). */
export const Icon = {
  flask: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" /><path d="M7 15h10" /></svg>,
  pill: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="m9.2 7.9 5.6 8.2" /></svg>,
  building: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4" /></svg>,
  rocket: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 10l-4 4M9 15l-2-2 3.5-6.5C12.5 3 17 3 21 3c0 4 0 8.5-3.5 10.5L11 17l-2-2Z" /></svg>,
  pulse: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>,
  globe: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
};
