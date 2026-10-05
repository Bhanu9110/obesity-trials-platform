// Shared display helpers (safe for both server and client components).

export const CONTINENT_ORDER = [
  "North America", "South America", "Europe", "Africa", "Asia", "Oceania", "Other",
];

export function sortContinents(cs: string[]): string[] {
  return [...cs].sort((a, b) => {
    const ia = CONTINENT_ORDER.indexOf(a);
    const ib = CONTINENT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** "PHASE2, PHASE3" -> "Phase 2/3", "EARLY_PHASE1" -> "Early Phase 1", "NA" -> "N/A". */
export function formatPhase(raw: string | null | undefined): string {
  if (!raw) return "—";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0] === "NA") return "N/A";
  if (parts.length === 1 && parts[0] === "EARLY_PHASE1") return "Early Phase 1";
  const nums = parts.map((p) => p.replace(/^PHASE/i, "")).filter((n) => /^\d$/.test(n));
  if (!nums.length) return raw;
  return `Phase ${nums.join("/")}`;
}

/** Sort key: higher = later stage. Phase 2/3 sits between 2 and 3. */
export function phaseRank(raw: string | null | undefined): number {
  if (!raw) return -1;
  if (raw === "NA") return 0;
  if (raw === "EARLY_PHASE1") return 0.5;
  const nums = (raw.match(/PHASE(\d)/g) ?? []).map((p) => Number(p.slice(5)));
  if (!nums.length) return -1;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Highest phase among a trial set, formatted. */
export function highestPhase(phases: (string | null)[]): string {
  const best = [...phases].sort((a, b) => phaseRank(b) - phaseRank(a))[0];
  return best ? formatPhase(best) : "—";
}

/** The trial page on this website. */
export function trialUrl(nctId: string): string {
  return `/trials/${encodeURIComponent(nctId)}`;
}

/** The original registry record (cited as the source on the trial page). */
export function ctgovUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`;
}

export const SPONSOR_GROUPS: Record<string, { label: string; classes: string }> = {
  INDUSTRY: { label: "Industry only", classes: "INDUSTRY" },
  GOV: { label: "Government / NIH", classes: "NIH,FED,OTHER_GOV" },
  ACADEMIC: { label: "Academic / other", classes: "OTHER,NETWORK,INDIV,AMBIG,UNKNOWN" },
};

/** Obesity classification of a trial (set by the daily sync). */
export const OBESITY_CLASSES: Record<string, { label: string; short: string; badge: string }> = {
  primary: { label: "Primary obesity", short: "Primary", badge: "bg-emerald-50 text-emerald-700" },
  comorbidity: { label: "Obesity as comorbidity", short: "Comorbidity", badge: "bg-amber-50 text-amber-700" },
  weight_related: { label: "Weight-related (no obesity term)", short: "Weight-related", badge: "bg-sky-50 text-sky-700" },
  unrelated: { label: "Not obesity", short: "Not obesity", badge: "bg-slate-100 text-slate-600" },
};
export const OBESITY_CLASS_ORDER = ["primary", "comorbidity", "weight_related", "unrelated"];

/** CT.gov recruitment status -> label and badge colours (drug page, trial lists). */
export const TRIAL_STATUS: Record<string, { label: string; badge: string; active: boolean }> = {
  RECRUITING: { label: "Recruiting", badge: "bg-emerald-50 text-emerald-700", active: true },
  NOT_YET_RECRUITING: { label: "Not yet recruiting", badge: "bg-sky-50 text-sky-700", active: true },
  ENROLLING_BY_INVITATION: { label: "Enrolling by invitation", badge: "bg-emerald-50 text-emerald-700", active: true },
  ACTIVE_NOT_RECRUITING: { label: "Active, not recruiting", badge: "bg-amber-50 text-amber-700", active: true },
  COMPLETED: { label: "Completed", badge: "bg-slate-100 text-slate-600", active: false },
  SUSPENDED: { label: "Suspended", badge: "bg-orange-50 text-orange-700", active: false },
  TERMINATED: { label: "Terminated", badge: "bg-rose-50 text-rose-700", active: false },
  WITHDRAWN: { label: "Withdrawn", badge: "bg-rose-50 text-rose-700", active: false },
  UNKNOWN: { label: "Unknown status", badge: "bg-slate-100 text-slate-500", active: false },
};
export const TRIAL_STATUS_ORDER = Object.keys(TRIAL_STATUS);

export function statusInfo(s: string | null | undefined) {
  if (!s) return null;
  return TRIAL_STATUS[s] ?? { label: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "), badge: "bg-slate-100 text-slate-600", active: false };
}

/** "2025-03" / "2025-03-14" -> "Mar 2025". */
export function formatMonthYear(d: string | null | undefined): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})/);
  if (!m) return d?.match(/^\d{4}$/) ? d : null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return mon ? `${mon} ${m[1]}` : m[1];
}
