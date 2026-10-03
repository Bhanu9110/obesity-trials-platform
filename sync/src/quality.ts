// Data-quality checks for one ingested trial. Pure function (no database), so it
// is easy to test; the sync stores the result in trial_quality.

import type { MappedTrial } from "./mapper.js";

export type Severity = "error" | "warning" | "info";

export interface QualityIssue {
  code: string;
  severity: Severity;
  message: string;
  detail?: string[];
}

export interface QualityResult {
  score: number; // 0..1, 1 = no issues
  issues: QualityIssue[];
  error_count: number;
  warning_count: number;
  info_count: number;
}

// Interventions that legitimately name no product (not worth flagging).
const NON_PRODUCT_NAME_RE = /\b(placebos?|saline|vehicle|sham|dummy|matching|standard of care|usual care)\b/i;

const PENALTY: Record<Severity, number> = { error: 0.25, warning: 0.1, info: 0.02 };

/**
 * @param mapped     the parsed trial (all drug intervention names as registered)
 * @param kept       intervention names that matched at least one drug product
 * @param productCount number of distinct drug products linked
 * @param continents continents derived from the countries (contains "Other" for
 *                   countries missing from the country→continent table)
 * @param validationWarnings values cleaned / dropped by validateMapped()
 */
export function assessQuality(
  mapped: MappedTrial,
  kept: string[],
  productCount: number,
  continents: string[],
  unknownCountries: string[] = [],
  validationWarnings: string[] = [],
): QualityResult {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: Severity, message: string, detail?: string[]) =>
    issues.push(detail?.length ? { code, severity, message, detail } : { code, severity, message });

  if (!mapped.sponsor) add("MISSING_SPONSOR", "error", "No lead sponsor.");
  if (!mapped.conditions.length) add("NO_CONDITIONS", "error", "No condition / indication listed.");
  if (!mapped.phase) add("MISSING_PHASE", "warning", "No phase given.");
  else if (mapped.phase === "NA") add("PHASE_NOT_APPLICABLE", "info", "Phase is 'Not applicable'.");

  if (!mapped.interventions.length) {
    add("NO_DRUG_INTERVENTION", "warning", "No drug / biological intervention listed.");
  } else if (productCount === 0) {
    add("NO_DRUG_PRODUCT", "warning", "Drug interventions listed, but none could be matched to a drug.", mapped.interventions);
  }
  const keptSet = new Set(kept);
  const unmatched = mapped.interventions.filter((n) => !keptSet.has(n) && !NON_PRODUCT_NAME_RE.test(n));
  if (unmatched.length && productCount > 0) {
    add("UNMATCHED_INTERVENTION", "info", "Some drug interventions did not match a drug.", unmatched);
  }

  if (!mapped.countries.length) add("NO_LOCATION", "warning", "No site countries listed.");
  else if (continents.includes("Other")) {
    add("UNKNOWN_COUNTRY", "warning", "Country not in the continent table (shown as 'Other').", unknownCountries);
  }

  if (!mapped.source_updated_at) add("MISSING_SOURCE_UPDATED_AT", "info", "Registry last-update date missing.");
  if (validationWarnings.length) {
    add("VALIDATION_WARNING", "info", "Some registry values were cleaned or dropped.", validationWarnings);
  }

  const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  return {
    score: Math.max(0, Math.round((1 - penalty) * 1000) / 1000),
    issues,
    error_count: count("error"),
    warning_count: count("warning"),
    info_count: count("info"),
  };
}
