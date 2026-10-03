// Plain-language names for the issue codes produced by sync/src/quality.ts.
export const QUALITY_LABELS: Record<string, string> = {
  MISSING_SPONSOR: "No lead sponsor",
  NO_CONDITIONS: "No indication listed",
  MISSING_PHASE: "No phase",
  PHASE_NOT_APPLICABLE: "Phase 'Not applicable'",
  NO_DRUG_INTERVENTION: "No drug intervention",
  NO_DRUG_PRODUCT: "Drug not recognised",
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
