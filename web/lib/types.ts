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
  modality: string | null;
  phase: string | null;
  moa: string | null;
  roa: string | null;
  approved: string | null; // "Yes" | "No" | null
  approval_date: string | null; // YYYY-MM-DD
  sponsor: string | null;
  drug_class: string | null;
}

export const PRODUCT_INFO_FIELDS: (keyof ProductInfo)[] = [
  "modality", "phase", "moa", "roa", "approved", "approval_date", "sponsor", "drug_class",
];

export interface Product extends ProductInfo {
  id: number;
  slug: string;
  name: string;
  info_updated_at: string | null;
}

export interface ProductTrial {
  nct_id: string;
  phase: string | null;
  sponsor: string | null;
  indication: string[];
  continents: string[];
  obesity_class: string;
  obesity_reason: string | null;
}

export interface ProductSummary {
  slug: string;
  name: string;
  trials: number;      // primary-obesity trials
  all_trials: number;  // all stored trials (incl. comorbidity / weight-related / not obesity)
  trial_phases: string[];
  modality: string | null;
  phase: string | null;
  drug_class: string | null;
  approved: string | null;
  sponsor: string | null;
  has_info: boolean;
}
