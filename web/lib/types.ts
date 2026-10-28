// Lean data model: per trial only phase, sponsor, indication, interventions
// (as drug products) and location (continents). The NCT ID opens the trial page
// (/trials/NCT…), which shows the full registry record (lib/ctgov.ts).

export interface ProductLink {
  slug: string;
  name: string;
}

export interface TrialListItem {
  nct_id: string;
  title: string | null;
  phase: string | null;
  sponsor: string | null;
  lead_sponsor_class: string | null;
  overall_status: string | null;
  start_date: string | null;
  enrollment: number | null;
  indication: string[];
  continents: string[];
  products: ProductLink[];
  obesity_class: string;
  obesity_reason: string | null;
}

export interface TrialsResponse {
  items: TrialListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FilterOptions {
  phases: string[];
  continents: { name: string; countries: string[] }[];
  /** stored trials per obesity class */
  classes: { name: string; trials: number }[];
  /** headline numbers for the home page */
  stats?: HomeStats;
  /** trials per phase / status / sponsor type (primary obesity), for the filter panel */
  facets?: { phases: Record<string, number>; statuses: Record<string, number>; sponsorClasses: Record<string, number> };
}

export interface HomeStats {
  trials: number;        // primary-obesity trials shown on the website
  drugs: number;         // drugs with at least one of those trials
  industry: number;      // trials sponsored by industry
  late: number;          // Phase 3 / Phase 4 (incl. Phase 2/3)
  recruiting: number;    // recruiting or not yet recruiting
  countries: number;
  lastSync: string | null;
}

/** Manually curated product info (all blank until edited on the drug page). */
export interface ProductInfo {
  // Drug profile — entered by hand on the drug page (blank until filled in).
  aliases: string | null;          // development / code names
  brand_names: string | null;
  candidate: string | null;        // "Pipeline" | "Non-pipeline" | null
  parent_drug: string | null;      // similar or parent drug(s)
  sponsor: string | null;          // shown as "Company"
  drug_class: string | null;       // therapy class
  therapy_subclass: string | null;
  indication: string | null;
  modality: string | null;
  phase: string | null;
  moa: string | null;
  roa: string | null;
  approved: string | null; // "Yes" | "No" | null
  approval_date: string | null; // YYYY-MM-DD
  // Development & regulatory (migration 0024)
  inn: string | null;                 // International Nonproprietary Name
  api: string | null;                 // active pharmaceutical ingredient (salt / form)
  regulatory_status: string | null;   // "Approved — US (2023)", "Under FDA review", "Investigational — Phase 3"
  designations: string | null;        // Breakthrough Therapy, Fast Track, PRIME, priority voucher …
  patents: string | null;             // key patent / exclusivity expiries
  anticipated_launch: string | null;  // launch timeline
  efficacy_signal: string | null;     // headline efficacy
  safety_signal: string | null;       // headline safety / tolerability
}

export const PRODUCT_INFO_FIELDS: (keyof ProductInfo)[] = [
  "aliases", "brand_names", "candidate", "parent_drug", "sponsor", "drug_class", "therapy_subclass", "indication",
  "modality", "phase", "moa", "roa", "approved", "approval_date",
  "inn", "api", "regulatory_status", "designations", "patents", "anticipated_launch", "efficacy_signal", "safety_signal",
];
/** The development & regulatory fields: longer text allowed. */
export const LONG_INFO_FIELDS = new Set<keyof ProductInfo>(["api", "regulatory_status", "designations", "patents", "anticipated_launch", "efficacy_signal", "safety_signal"]);

/** An efficacy or safety result of one trial (research files or typed on the drug page). */
export interface ProductResult {
  id: number;
  kind: "efficacy" | "safety";
  trial: string | null; phase: string | null; population: string | null; duration: string | null; dose: string | null;
  endpoint: string | null; result: string; comparator: string | null; reported: string | null;
  source_label: string | null; source_url: string | null;
  origin: "curated" | "manual"; hidden: boolean;
}
export const MILESTONE_KINDS = ["regulatory", "readout", "launch", "patent", "inflection", "milestone"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
export const MILESTONE_STATUSES = ["done", "expected", "delayed", "cancelled"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
/** A dated event: regulatory step, readout, launch, patent expiry, inflection point or upcoming milestone. */
export interface ProductMilestone {
  id: number;
  kind: MilestoneKind;
  title: string; detail: string | null;
  date_label: string | null; date_sort: string | null;
  status: MilestoneStatus; region: string | null;
  source_label: string | null; source_url: string | null;
  origin: "curated" | "manual"; hidden: boolean;
}
/** The next expected milestone of a drug, for the Drugs list and the upcoming panel. */
export interface UpcomingMilestone {
  slug: string; name: string; kind: MilestoneKind; title: string; date_label: string | null; date_sort: string | null;
  region: string | null; source_url: string | null;
}


/** An automatic or researched drug-profile value and where it came from (ChEMBL, openFDA, Trials, a research file …). */
export interface AutoValue { value: string; source: string; url?: string; curated?: boolean } // curated: from a research file

export interface Product extends ProductInfo {
  id: number;
  auto: Partial<Record<keyof ProductInfo, AutoValue>>; // fields currently shown from the auto-fill
  autofill_at: string | null;          // last auto-fill run (ISO)
  summary: string | null;             // hand-written product summary
  summary_updated_at: string | null;
  trials: number;      // primary-obesity trials (counted automatically)
  all_trials: number;  // all stored trials
  nct_trials: number;  // ClinicalTrials.gov trials in the database
  conference_trials: number; // no NCT trial yet: clinical trials reported in conference abstracts (counted in trials)
  slug: string;
  name: string;
  info_updated_at: string | null;
  kind: "supplement" | "not_drug" | "other_drug" | null;     // null = a drug (listed); else left out of the drug list
  kind_source: "list" | "rule" | "manual" | null;
  kind_note: string | null;
}

export interface ProductTrial {
  nct_id: string;
  title: string | null;              // registry brief title
  phase: string | null;
  sponsor: string | null;
  lead_sponsor_class: string | null; // INDUSTRY | NIH | OTHER ...
  indication: string[];
  continents: string[];
  overall_status: string | null;     // RECRUITING | COMPLETED | ...
  start_date: string | null;         // YYYY-MM or YYYY-MM-DD
  enrollment: number | null;
  obesity_class: string;
  obesity_reason: string | null;
}

export interface ProductSummary extends ProductInfo {
  slug: string;
  name: string;
  trials: number;      // primary-obesity trials
  all_trials: number;  // all stored trials (incl. comorbidity / weight-related / not obesity)
  trial_phases: string[];
  has_info: boolean;   // at least one field entered by hand
  nct_trials: number;  // ClinicalTrials.gov trials in the database (all classes)
  conference_trials: number; // no NCT trial yet: clinical trials its conference abstracts report (counted in trials)
  abstracts: number;   // conference abstracts naming the drug (e.g. ADA 2026)
  abstract_sources: string | null; // "ADA 2026"
  reports_only: boolean; // linked only to company pipeline reports (no conference abstract)
  other_names: string | null; // every other name the database knows (merged spellings, codes, abstract names), for search
  next_milestone: { title: string; date_label: string | null; kind: MilestoneKind } | null; // the next expected milestone
  active_trials: number;          // trials recruiting, about to start or still running (all classes)
  last_trial_year: number | null; // start year of its newest trial
}
