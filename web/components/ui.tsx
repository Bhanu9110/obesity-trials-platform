import Link from "next/link";
import { ctgovUrl, formatPhase, sortContinents } from "@/lib/format";
import type { ProductLink } from "@/lib/types";

export function Dash() {
  return <span className="text-slate-300">—</span>;
}

/** NCT ID that opens the study on ClinicalTrials.gov in a new tab. */
export function NctLink({ id }: { id: string }) {
  return (
    <a
      href={ctgovUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open on ClinicalTrials.gov"
      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs font-medium text-brand-600 hover:underline"
    >
      {id}
      <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 opacity-70">
        <path d="M4.5 2H10v5.5M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </a>
  );
}

export function PhaseText({ phase }: { phase: string | null }) {
  return phase ? <span className="whitespace-nowrap">{formatPhase(phase)}</span> : <Dash />;
}

export function Chips({ values, max = 3 }: { values: string[]; max?: number }) {
  if (!values?.length) return <Dash />;
  const shown = values.slice(0, max);
  const extra = values.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((v) => (
        <span key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
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
        <span key={c} className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
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
          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 hover:underline"
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
