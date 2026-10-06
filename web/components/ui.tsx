import Link from "next/link";
import { formatPhase, sortContinents, statusInfo, trialUrl } from "@/lib/format";
import type { ProductLink } from "@/lib/types";

export function Dash() {
  return <span className="text-slate-300">—</span>;
}

/** NCT ID that opens the full trial page on this website. */
export function NctLink({ id }: { id: string }) {
  return (
    <Link
      href={trialUrl(id)}
      title="Open full trial details"
      className="whitespace-nowrap rounded-md font-mono text-xs font-medium text-brand-600 transition hover:text-brand-700 hover:[text-shadow:0_0_12px_rgb(34_211_238/0.6)]"
    >
      {id}
    </Link>
  );
}

/** Phase as a coloured pill: early phases cool, late phases warm. */
export function PhaseText({ phase }: { phase: string | null }) {
  if (!phase) return <Dash />;
  const p = phase.toUpperCase();
  const tone =
    p.includes("PHASE4") ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
    p.includes("PHASE3") ? "bg-pink-50 text-pink-700 ring-pink-200" :
    p.includes("PHASE2") ? "bg-violet-50 text-violet-700 ring-violet-200" :
    p.includes("PHASE1") ? "bg-sky-50 text-sky-700 ring-sky-200" :
    "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}>
      {formatPhase(phase)}
    </span>
  );
}

export function Chips({ values, max = 3 }: { values: string[]; max?: number }) {
  if (!values?.length) return <Dash />;
  const shown = values.slice(0, max);
  const extra = values.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((v) => (
        <span key={v} className="rounded-md bg-slate-100/80 px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200/70">
          {v}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-slate-400" title={values.slice(max).join(", ")}>
          +{extra}
        </span>
      )}
    </div>
  );
}

export function ContinentChips({ continents }: { continents: string[] }) {
  if (!continents?.length) return <Dash />;
  return (
    <div className="flex flex-wrap gap-1">
      {sortContinents(continents).map((c) => (
        <span key={c} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200/60">
          <span className="h-1 w-1 rounded-full bg-sky-400" />
          {c}
        </span>
      ))}
    </div>
  );
}

/** Drug chips that open the drug page. */
export function ProductChips({ products, max = 4 }: { products: ProductLink[]; max?: number }) {
  if (!products?.length) return <Dash />;
  const shown = products.slice(0, max);
  const extra = products.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((p) => (
        <Link
          key={p.slug}
          href={`/drugs/${encodeURIComponent(p.slug)}`}
          className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-700 ring-1 ring-accent-200/70 transition hover:bg-accent-100 hover:text-accent-800"
        >
          {p.name}
        </Link>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-slate-400" title={products.slice(max).map((p) => p.name).join(", ")}>
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Registry status as a pill with a coloured dot (pulsing while recruiting). */
export function StatusPill({ status, compact = false }: { status: string | null | undefined; compact?: boolean }) {
  const info = statusInfo(status);
  if (!info) return <Dash />;
  const live = status === "RECRUITING" || status === "ENROLLING_BY_INVITATION";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-slate-200/60 ${info.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${live ? "animate-pulse-dot" : "opacity-70"}`} />
      {compact ? info.label.replace("Active, not recruiting", "Active").replace("Not yet recruiting", "Not yet open").replace("Enrolling by invitation", "By invitation") : info.label}
    </span>
  );
}
