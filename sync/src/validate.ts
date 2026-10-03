// Validation and clean-up of a parsed trial before it is written.
//
//   errors   -> the record is NOT written; it goes to the retry queue
//               (sync_failures, type "validation") and, if it keeps failing,
//               to the dead-letter queue for a person to look at.
//   warnings -> the value is cleaned / dropped and the record is written; the
//               warnings show up on the Data quality page (VALIDATION_WARNING).

import type { MappedTrial } from "./mapper.js";

export interface ValidationResult {
  value: MappedTrial;
  errors: string[];
  warnings: string[];
}

export const NCT_RE = /^NCT\d{8}$/;

const PHASES = new Set(["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"]);
const SPONSOR_CLASSES = new Set([
  "INDUSTRY", "NIH", "FED", "OTHER_GOV", "INDIV", "NETWORK", "OTHER", "UNKNOWN", "AMBIG",
]);

const LIMITS = { text: 300, conditions: 100, interventions: 200, countries: 250 };

/** Remove control characters, collapse whitespace, trim. */
export function cleanText(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanList(values: string[], max: number, label: string, warnings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let truncated = 0;
  for (const v of values ?? []) {
    let t = cleanText(v);
    if (!t) continue;
    if (t.length > LIMITS.text) {
      t = t.slice(0, LIMITS.text);
      truncated++;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  if (truncated) warnings.push(`${truncated} ${label} value(s) longer than ${LIMITS.text} characters were shortened.`);
  if (out.length > max) {
    warnings.push(`${out.length} ${label} values; only the first ${max} are kept.`);
    return out.slice(0, max);
  }
  return out;
}

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate and normalise one parsed trial. Pure function (no database). */
export function validateMapped(m: MappedTrial, today: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nct = cleanText(m.nct_id).toUpperCase();
  if (!nct) errors.push("Missing NCT ID.");
  else if (!NCT_RE.test(nct)) errors.push(`Invalid NCT ID "${nct.slice(0, 40)}".`);

  // Phase: "PHASE2" or "PHASE2, PHASE3" — keep the known values only.
  let phase: string | null = null;
  if (m.phase) {
    const parts = cleanText(m.phase).toUpperCase().split(/\s*[,/]\s*/).filter(Boolean);
    const known = parts.filter((p) => PHASES.has(p));
    const unknown = parts.filter((p) => !PHASES.has(p));
    if (unknown.length) warnings.push(`Unknown phase value(s) dropped: ${unknown.join(", ")}.`);
    phase = known.length ? [...new Set(known)].join(", ") : null;
  }

  let sponsor = m.sponsor ? cleanText(m.sponsor) : null;
  if (sponsor && sponsor.length > LIMITS.text) {
    sponsor = sponsor.slice(0, LIMITS.text);
    warnings.push(`Sponsor name longer than ${LIMITS.text} characters was shortened.`);
  }
  if (sponsor === "") sponsor = null;

  let sponsorClass = m.lead_sponsor_class ? cleanText(m.lead_sponsor_class).toUpperCase() : null;
  if (sponsorClass && !SPONSOR_CLASSES.has(sponsorClass)) {
    warnings.push(`Unknown sponsor class "${sponsorClass.slice(0, 40)}" stored as UNKNOWN.`);
    sponsorClass = "UNKNOWN";
  }
  if (sponsorClass === "") sponsorClass = null;

  let updated = m.source_updated_at;
  if (updated) {
    const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    if (!isRealDate(updated)) {
      warnings.push(`Invalid last-update date "${updated}" ignored.`);
      updated = null;
    } else if (updated > tomorrow) {
      warnings.push(`Last-update date ${updated} is in the future; ignored.`);
      updated = null;
    } else if (updated < "1999-01-01") {
      warnings.push(`Last-update date ${updated} is before ClinicalTrials.gov existed; ignored.`);
      updated = null;
    }
  }

  const value: MappedTrial = {
    nct_id: nct,
    phase,
    sponsor,
    lead_sponsor_class: sponsorClass,
    conditions: cleanList(m.conditions, LIMITS.conditions, "condition", warnings),
    interventions: cleanList(m.interventions, LIMITS.interventions, "intervention", warnings),
    countries: cleanList(m.countries, LIMITS.countries, "country", warnings).sort((a, b) => a.localeCompare(b)),
    source_updated_at: updated,
  };
  return { value, errors, warnings };
}

/** Basic shape check of a CT.gov /studies response page. */
export function checkStudiesPage(body: unknown): string | null {
  if (!body || typeof body !== "object") return "response is not a JSON object";
  const b = body as Record<string, unknown>;
  if (b.studies !== undefined && !Array.isArray(b.studies)) return "`studies` is not a list";
  if (b.nextPageToken !== undefined && b.nextPageToken !== null && typeof b.nextPageToken !== "string") {
    return "`nextPageToken` is not a string";
  }
  return null;
}
