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
