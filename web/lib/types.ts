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
}

export const PRODUCT_INFO_FIELDS: (keyof ProductInfo)[] = [
  "aliases", "brand_names", "candidate", "parent_drug", "sponsor", "drug_class", "therapy_subclass", "indication",
  "modality", "phase", "moa", "roa", "approved", "approval_date",
];


export interface Product extends ProductInfo {
  id: number;
  trials: number;      // primary-obesity trials (counted automatically)
  all_trials: number;  // all stored trials
  slug: string;
  name: string;
  info_updated_at: string | null;
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
  has_info: boolean;
}
