// Shown when a search names a drug class ("GLP-1 agonists", "amylin analogues"): every drug of the
// class is listed, not only names that contain the words.

const KIND_CHIP: Record<string, string> = {
  single: "bg-sky-50 text-sky-700 ring-sky-200",
  dual: "bg-violet-50 text-violet-700 ring-violet-200",
  triple: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  multi: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  combination: "bg-amber-50 text-amber-800 ring-amber-200",
  other: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** Small tag: "GLP-1 only", "Dual: GIP + GLP-1", "Combination: amylin + GLP-1". */
export function ClassTag({ kind, label }: { kind: string; label: string }) {
  if (!label) return null;
  return <span className={`inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${KIND_CHIP[kind] ?? KIND_CHIP.other}`}>{label}</span>;
}

const NOTE = "Every drug of the class is included — combinations and dual / triple agonists too, each labelled. Classes come from the drug profiles (sub-class, mechanism) or the name stem.";

export default function ClassBanner({ label, count, noun, summary, note = NOTE }: { label: string; count: number; noun: string; summary?: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-brand-500/30 bg-brand-500/5 px-4 py-2.5 text-sm">
      <span className="rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Drug class</span>
      <span className="font-semibold text-slate-900">{label}</span>
      <span className="text-slate-600">{count.toLocaleString()} {noun}</span>
      {summary && <span className="text-xs text-slate-500">{summary}</span>}
      <span className="basis-full text-xs text-slate-500">{note}</span>
    </div>
  );
}
