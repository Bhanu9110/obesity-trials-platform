// Development stage of a drug, for the Drugs list (stage chips, cards, table) and the drug page.
//
// The stage is NOT just the highest trial phase. In order:
//   1. Discontinued / withdrawn  — the regulatory status or phase says so (research file, typed on
//      the drug page, or found automatically). The phase it reached is kept as detail.
//   2. Approved                  — approved in ANY country (e.g. mazdutide in China), even when its
//      trials only go up to Phase 3. Phase 4 trials also mean the drug is on the market.
//   3. Filed / under review
//   4. No active development     — every ClinicalTrials.gov trial has ended, the newest one started
//      INACTIVE_YEARS or more years ago, and nothing says the drug is still in development.
//   5. Phase 3 / 2 / 1           — the highest phase of its trials (or of its profile); with no phase
//      anywhere, estimated from the enrollment of its largest interventional trial ("Phase 2 (est.)").
//   6. Preclinical / conference  — known only from conference abstracts or company reports.

import type { ProductSummary } from "@/lib/types";
import { regGroup } from "@/lib/regulatory";
import { phaseFromEnrollment } from "@/lib/format";

export type StageKey = "approved" | "filed" | "p3" | "p2" | "p1" | "early" | "stopped" | "inactive";

export const STAGE_META: Record<StageKey, { label: string; chip: string; order: number }> = {
  approved: { label: "Approved", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", order: 7 },
  filed: { label: "Filed", chip: "bg-violet-50 text-violet-700 ring-violet-200", order: 6 },
  p3: { label: "Phase 3", chip: "bg-sky-50 text-sky-700 ring-sky-200", order: 5 },
  p2: { label: "Phase 2", chip: "bg-sky-50 text-sky-700 ring-sky-200", order: 4 },
  p1: { label: "Phase 1", chip: "bg-sky-50 text-sky-700 ring-sky-200", order: 3 },
  early: { label: "Preclinical / no NCT yet", chip: "bg-amber-50 text-amber-700 ring-amber-200", order: 2 },
  inactive: { label: "No active development", chip: "bg-slate-100 text-slate-600 ring-slate-200", order: 1 },
  stopped: { label: "Discontinued", chip: "bg-rose-50 text-rose-700 ring-rose-200", order: 0 },
};

/** Years without a new trial (and none running) before a drug counts as "no active development". */
export const INACTIVE_YEARS = 7;

type StageInput = Pick<ProductSummary, "phase" | "approved" | "regulatory_status" | "trial_phases" | "abstracts" | "nct_trials">
  & Partial<Pick<ProductSummary, "active_trials" | "last_trial_year" | "unphased_enrollment">>;

export interface DevStage {
  key: StageKey;
  /** short text for a badge: "Approved (China)", "Discontinued", "Phase 3" */
  label: string;
  /** highest phase reached (1–4), from trials or profile; 0 = not known */
  reached: number;
  /** one line of detail for a tooltip */
  detail: string;
}

const level = (p: string) => (/PHASE4/.test(p) ? 4 : /PHASE3/.test(p) ? 3 : /PHASE2/.test(p) ? 2 : /PHASE1/.test(p) ? 1 : 0);

export function reachedPhase(p: Pick<ProductSummary, "trial_phases" | "phase">): number {
  const fromTrials = p.trial_phases.reduce((m, x) => Math.max(m, level(x)), 0);
  const fromProfile = Math.max(0, ...[...(p.phase ?? "").matchAll(/\b([1-4])\b/g)].map((m) => Number(m[1])));
  return Math.max(fromTrials, fromProfile);
}

/** Countries named in an approval text: "Approved — China (NMPA, Jun 2025 …)" -> "China". */
function approvedWhere(status: string): string {
  const s = status.replace(/\(.*?\)/g, " ");
  const head = s.split(/[;—–]/).slice(0, 2).join(" ");
  const names: string[] = [];
  for (const [re, name] of [[/\bUS\b|\bFDA\b|United States/, "US"], [/\bEU\b|\bEMA\b|Europe/, "EU"], [/China|NMPA/, "China"],
    [/Japan|PMDA/, "Japan"], [/Korea|MFDS/, "Korea"], [/India|CDSCO/, "India"], [/Mexico|COFEPRIS/, "Mexico"], [/\bUK\b|MHRA/, "UK"]] as const) {
    if (re.test(head) && !names.includes(name)) names.push(name);
  }
  return names.length && !names.includes("US") ? names.join(", ") : "";
}

export function devStage(p: StageInput, now = new Date()): DevStage {
  const status = (p.regulatory_status ?? "").trim();
  const phaseText = (p.phase ?? "").trim();
  const group = regGroup(status, p.approved);
  const reached = reachedPhase(p);
  const reachedText = reached ? ` (reached Phase ${reached})` : "";

  // 1. Stopped: discontinued, terminated or withdrawn (an approved drug taken off the market too).
  if (group === "stopped" || /discontinu|terminated|withdrawn|abandoned/i.test(phaseText)) {
    const withdrawn = /withdrawn/i.test(status || phaseText);
    return { key: "stopped", label: withdrawn ? "Withdrawn" : "Discontinued", reached, detail: (status || phaseText) + (withdrawn ? "" : reachedText) };
  }
  // 2. Approved anywhere.
  // Phase 4 (post-marketing) trials count only when no status says the drug is still investigational.
  const phase4 = p.trial_phases.some((x) => /PHASE4/.test(x)) && group !== "investigational" && group !== "review";
  if (group === "approved" || /^approved|^marketed|^launched/i.test(phaseText) || phase4) {
    const where = approvedWhere(status || phaseText);
    return { key: "approved", label: where ? `Approved (${where})` : "Approved", reached: 4, detail: status || phaseText || "Has Phase 4 (post-marketing) trials" };
  }
  // 3. Filed.
  if (group === "review" || /registration|filed|pre-?registration/i.test(phaseText)) {
    return { key: "filed", label: "Filed", reached, detail: status || phaseText };
  }
  // 4. No active development: no running trial and the newest one is old.
  const last = p.last_trial_year ?? null;
  if (p.nct_trials > 0 && (p.active_trials ?? 1) === 0 && last !== null && now.getFullYear() - last >= INACTIVE_YEARS) {
    return { key: "inactive", label: "No active development", reached,
      detail: `No trial running; the newest trial started in ${last}${reachedText}. Not confirmed as discontinued by the company.` };
  }
  // 5. Clinical phase. No phase on ClinicalTrials.gov (and none in the profile): estimated from the
  //    enrollment of its largest interventional trial — Phase 1 up to ~100, Phase 2 ~100–300, Phase 3 more.
  if (!reached && p.nct_trials > 0 && p.unphased_enrollment) {
    const est = Number(phaseFromEnrollment(p.unphased_enrollment)?.slice(-1) ?? 0);
    if (est) {
      return { key: (["p1", "p2", "p3"] as const)[est - 1], label: `Phase ${est} (est.)`, reached: est,
        detail: `No phase on ClinicalTrials.gov — estimated from enrollment (${p.unphased_enrollment.toLocaleString("en-US")} participants; Phase 1 up to ~100, Phase 2 ~100–300, Phase 3 more than 300)` };
    }
  }
  if (reached >= 3) return { key: "p3", label: "Phase 3", reached, detail: status || "Highest trial phase" };
  if (reached === 2) return { key: "p2", label: "Phase 2", reached, detail: status || "Highest trial phase" };
  if (reached === 1) return { key: "p1", label: "Phase 1", reached, detail: status || "Highest trial phase" };
  // 6. Preclinical or known only from conference abstracts / company reports.
  return { key: "early", label: /preclinical/i.test(phaseText) ? "Preclinical" : p.abstracts > 0 && p.nct_trials === 0 ? "No NCT yet" : "Phase not known",
    reached, detail: status || phaseText || "No trial phase known" };
}
