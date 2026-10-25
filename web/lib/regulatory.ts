// Regulatory status in a few groups, for the Drugs-list filter and badges. The status itself is free
// text (typed on the drug page, from a research file, or worked out automatically).

export type RegGroup = "approved" | "review" | "investigational" | "stopped" | "unknown";

export const REG_GROUPS: { key: RegGroup; label: string; chip: string }[] = [
  { key: "approved", label: "Approved", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "review", label: "Filed / under review", chip: "bg-violet-50 text-violet-700 ring-violet-200" },
  { key: "investigational", label: "Investigational", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  { key: "stopped", label: "Discontinued / withdrawn", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  { key: "unknown", label: "Not known", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
];

export function regGroup(status: string | null | undefined, approved?: string | null): RegGroup {
  const s = (status ?? "").trim().toLowerCase();
  if (/^approved|^marketed|^launched/.test(s)) return "approved";
  if (/under (fda |ema )?review|submitted|filed|registration|pdufa|nda|bla|maa/.test(s)) return "review";
  if (/discontinu|withdrawn|terminated|stopped/.test(s)) return "stopped";
  if (/investigational|phase|preclinical|clinical/.test(s)) return "investigational";
  if (!s && approved === "Yes") return "approved";
  return "unknown";
}

/** The status up to its first "—" detail or 60 characters: "Approved — US: Wegovy …" -> "Approved — US: Wegovy …". */
export function shortStatus(status: string | null | undefined, max = 60): string {
  const s = (status ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/[\s,;:—-]+$/, "")}…` : s;
}
