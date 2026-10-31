// Reviewed Phase 1 / clinical-pharmacology trials (sync/data/phase1-healthy-volunteers.json).
//
// ClinicalTrials.gov registers many early studies of obesity drugs under "Healthy", "Hepatic
// Impairment", "Drug Drug Interaction" … instead of obesity, so the normal obesity search never
// returns them and the classifier would call them "unrelated". The trials on this list were
// reviewed by the site owner: the sync fetches them by NCT ID on every run (any condition) and
// stores them as primary obesity trials with a label, in the phase CT.gov gives them.

import { readFileSync } from "node:fs";
import type { ObesityClassification } from "./obesity-filter.js";

export const CURATED_LABEL = "Phase 1 – healthy volunteers / clinical pharmacology";

interface CuratedFile {
  label?: string;
  trials: { nct: string; drug?: string }[];
}

let cache: Set<string> | null = null;

/** NCT IDs on the reviewed list (upper case). */
export function curatedIds(): Set<string> {
  if (cache) return cache;
  try {
    const j = JSON.parse(readFileSync(new URL("../data/phase1-healthy-volunteers.json", import.meta.url), "utf8")) as CuratedFile;
    cache = new Set((j.trials ?? []).map((t) => String(t.nct).trim().toUpperCase()).filter((x) => /^NCT\d{8}$/.test(x)));
  } catch {
    cache = new Set();
  }
  return cache;
}

/** For tests. */
export function setCuratedIds(ids: string[] | null): void {
  cache = ids ? new Set(ids.map((x) => x.toUpperCase())) : null;
}

export const isCurated = (nct: string | null | undefined) => !!nct && curatedIds().has(nct.toUpperCase());

/** The classification a reviewed trial gets (null when the trial is not on the list). */
export function curatedClassification(nct: string | null | undefined): ObesityClassification | null {
  if (!isCurated(nct)) return null;
  return { class: "primary", reason: `${CURATED_LABEL} (reviewed list).`, terms: [CURATED_LABEL] };
}

/** Is this stored reason the curated label? (web shows a tag for it) */
export const isCuratedReason = (reason: string | null | undefined) => !!reason && reason.startsWith(CURATED_LABEL);
