// Lean data model: per trial only phase, sponsor, indication, interventions
// (as drug products) and location (continents). The NCT ID opens the trial page
// (/trials/NCT…), which shows the full registry record (lib/ctgov.ts).

export interface ProductLink {
  slug: string;
  name: string;
}

export interface TrialListItem {
  nct_id: string;
  phase: string | null;
  sponsor: string | null;
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
}

/** Manually curated product info (all blank until edited on the drug page). */
export interface ProductInfo {
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

/** One profile value: entered by hand, or suggested automatically while blank. */
export interface ProfileValue {
  value: string | null;
  auto: boolean;
  /** why the automatic value was chosen (tooltip) */
  why?: string;
}

/** The Drugs-list profile of a drug (manual values win over suggestions). */
export interface DrugProfile {
  aliases: ProfileValue;
  brands: ProfileValue;
  candidate: ProfileValue;
  parent: ProfileValue;
  company: ProfileValue;
  therapyClass: ProfileValue;
  therapySubclass: ProfileValue;
  indication: ProfileValue;
}

/** Facts from the trial data used for the automatic suggestions. */
export interface ProductTrialFacts {
  top_industry_sponsor: string | null;
  industry_trials: number;
  solo_industry_trials: number;    // industry trials where it is the only drug
  has_phase4: boolean;
  top_conditions: string[];
  alias_slugs: string[];           // manual merges from product_aliases
}

export interface Product extends ProductInfo, ProductTrialFacts {
  id: number;
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

export interface ProductSummary extends ProductInfo, ProductTrialFacts {
  slug: string;
  name: string;
  trials: number;      // primary-obesity trials
  all_trials: number;  // all stored trials (incl. comorbidity / weight-related / not obesity)
  trial_phases: string[];
  has_info: boolean;
}
