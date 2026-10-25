import type { MilestoneKind, MilestoneStatus } from "./types";

// Shared by the drug page (server) and the milestone / Drugs-list components (client).

export const KIND_META: Record<MilestoneKind, { label: string; chip: string; dot: string }> = {
  regulatory: { label: "Regulatory", chip: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500" },
  readout: { label: "Readout", chip: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  launch: { label: "Launch", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  patent: { label: "Patent", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  inflection: { label: "Inflection point", chip: "bg-pink-50 text-pink-700 ring-pink-200", dot: "bg-pink-500" },
  milestone: { label: "Milestone", chip: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
};
export const STATUS_META: Record<MilestoneStatus, { label: string; chip: string }> = {
  done: { label: "Done", chip: "bg-slate-100 text-slate-600" },
  expected: { label: "Expected", chip: "bg-brand-500/10 text-brand-700" },
  delayed: { label: "Delayed", chip: "bg-amber-50 text-amber-800" },
  cancelled: { label: "Cancelled", chip: "bg-rose-50 text-rose-700" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-19" -> "19 Mar 2026", "2026-03" -> "Mar 2026", "2026-Q4" -> "Q4 2026", "2027" -> "2027". */
export function dateText(label: string | null): string {
  const s = (label ?? "").trim().toUpperCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${+m[3]} ${MONTHS[+m[2] - 1] ?? m[2]} ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${MONTHS[+m[2] - 1] ?? m[2]} ${m[1]}`;
  m = /^(\d{4})-?([QH][1-4])$/.exec(s);
  if (m) return `${m[2]} ${m[1]}`;
  return s || "Date not given";
}

/** Last day of the period a label names (to tell when an "expected" date has passed). */
export function periodEnd(label: string | null): Date | null {
  const s = (label ?? "").trim().toUpperCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2], 0));
  m = /^(\d{4})-?Q([1-4])$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] * 3, 0));
  m = /^(\d{4})-?H([12])$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] * 6, 0));
  m = /^(\d{4})$/.exec(s);
  return m ? new Date(Date.UTC(+m[1], 12, 0)) : null;
}

