// Plain-language names for the issue codes produced by sync/src/quality.ts.
export const QUALITY_LABELS: Record<string, string> = {
  MISSING_SPONSOR: "No lead sponsor",
  NO_CONDITIONS: "No indication listed",
  MISSING_PHASE: "No phase",
  PHASE_NOT_APPLICABLE: "Phase 'Not applicable'",
  NO_DRUG_INTERVENTION: "No drug intervention",
  NO_DRUG_PRODUCT: "No specific drug identified",
  UNMATCHED_INTERVENTION: "Some interventions not matched",
  NO_LOCATION: "No site countries",
  UNKNOWN_COUNTRY: "Country without continent",
  MISSING_SOURCE_UPDATED_AT: "No CT.gov update date",
  VALIDATION_WARNING: "Values cleaned on import",
};

export const SEV_STYLE: Record<string, string> = {
  error: "bg-rose-100 text-rose-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-slate-100 text-slate-600",
};

/** What each issue means (shown when hovering over an issue). */
export const QUALITY_HELP: Record<string, string> = {
  MISSING_SPONSOR: "CT.gov lists no lead sponsor.",
  NO_CONDITIONS: "CT.gov lists no condition / indication.",
  MISSING_PHASE: "CT.gov gives no phase.",
  PHASE_NOT_APPLICABLE: "Phase is 'Not applicable' (usual for non-drug or observational designs).",
  NO_DRUG_INTERVENTION: "No intervention is registered as a drug, biological or combination product.",
  NO_DRUG_PRODUCT:
    "Interventions are listed, but none names a specific drug — e.g. only a drug class (\"GLP-1 receptor agonist\"), only placebo, a study arm (\"FIM intervention arm\") or a sentence. The trial has no drug page.",
  UNMATCHED_INTERVENTION: "At least one drug was identified, but some other interventions name no specific drug.",
  NO_LOCATION: "CT.gov lists no site countries.",
  UNKNOWN_COUNTRY: "A country is not in the country → continent table (shown as 'Other').",
  MISSING_SOURCE_UPDATED_AT: "CT.gov's 'last update posted' date is missing.",
  VALIDATION_WARNING: "Some registry values were cleaned or dropped on import (see details).",
};
