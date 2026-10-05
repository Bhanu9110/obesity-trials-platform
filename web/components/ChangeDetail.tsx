import type { ChangeItem } from "@/lib/queries";
import { OBESITY_CLASSES, formatPhase } from "@/lib/format";
import { humanize } from "@/lib/ctgov";

// How one tracked change (trial_changes row) is shown — Changes page and trial page.

export const KIND_LABEL: Record<string, { label: string; style: string }> = {
  added: { label: "New trial", style: "bg-emerald-50 text-emerald-700" },
  updated: { label: "Updated", style: "bg-sky-50 text-sky-700" },
  reclassified: { label: "Reclassified", style: "bg-amber-50 text-amber-700" },
  removed: { label: "Removed", style: "bg-rose-50 text-rose-700" },
};
const FIELD_LABEL: Record<string, string> = {
  phase: "Phase",
  sponsor: "Sponsor",
  lead_sponsor_class: "Sponsor type",
  conditions: "Indication",
  interventions: "Interventions",
  countries: "Countries",
  obesity_class: "Obesity class",
  overall_status: "Status",
};

function show(field: string | null, v: unknown): string {
  if (v == null) return "—";
  if (field === "phase" && typeof v === "string") return formatPhase(v);
  if (field === "obesity_class" && typeof v === "string") return OBESITY_CLASSES[v]?.label ?? v;
  if (field === "overall_status" && typeof v === "string") return humanize(v);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

/** For list fields, show what was added / removed instead of both full lists. */
function ListDiff({ oldV, newV }: { oldV: unknown; newV: unknown }) {
  const a = Array.isArray(oldV) ? (oldV as string[]) : [];
  const b = Array.isArray(newV) ? (newV as string[]) : [];
  const added = b.filter((x) => !a.includes(x));
  const removed = a.filter((x) => !b.includes(x));
  if (!added.length && !removed.length) return <span className="text-slate-500">order changed</span>;
  return (
    <span className="space-x-2">
      {added.length > 0 && <span className="text-emerald-700">+ {added.join(", ")}</span>}
      {removed.length > 0 && <span className="text-rose-600 line-through decoration-rose-300">{removed.join(", ")}</span>}
    </span>
  );
}

export function ChangeDetail({ c }: { c: ChangeItem }) {
  if (c.change === "added" || c.change === "removed") {
    const s = (c.change === "added" ? c.new_value : c.old_value) as { phase?: string; sponsor?: string; obesity_class?: string } | null;
    return (
      <span className="text-slate-600">
        {formatPhase(s?.phase ?? null)} · {s?.sponsor ?? "no sponsor"}
        {s?.obesity_class && s.obesity_class !== "primary" && <> · {OBESITY_CLASSES[s.obesity_class]?.label}</>}
      </span>
    );
  }
  const label = FIELD_LABEL[c.field ?? ""] ?? c.field;
  const isList = Array.isArray(c.old_value) || Array.isArray(c.new_value);
  return (
    <span>
      <span className="font-medium text-slate-700">{label}:</span>{" "}
      {isList ? (
        <ListDiff oldV={c.old_value} newV={c.new_value} />
      ) : (
        <>
          <span className="text-slate-500">{show(c.field, c.old_value)}</span>
          <span className="px-1 text-slate-400">→</span>
          <span className="text-slate-800">{show(c.field, c.new_value)}</span>
        </>
      )}
    </span>
  );
}

