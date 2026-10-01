import type { RawStudy } from "./ctgov-client.js";

// Intervention types that count as drug PRODUCTS. Behavioural, device, procedure,
// dietary-supplement and "other" interventions are not stored.
export const PRODUCT_INTERVENTION_TYPES = new Set(["DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT"]);

// The only fields kept per trial: phase, sponsor, indication, interventions,
// location (countries; continents are derived in the database).
export interface MappedTrial {
  nct_id: string;
  phase: string | null;              // "PHASE2" or "PHASE2, PHASE3"
  sponsor: string | null;            // lead sponsor name
  lead_sponsor_class: string | null; // INDUSTRY | NIH | OTHER ...
  conditions: string[];              // indication(s)
  interventions: string[];           // drug intervention names as registered
  countries: string[];               // distinct site countries
}

function uniqTrimmed(values: (string | null | undefined)[], sort = false): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").replace(/\s+/g, " ").trim();
    if (t) out.add(t);
  }
  const arr = [...out]; // keeps registry order (e.g. the primary condition first)
  return sort ? arr.sort((a, b) => a.localeCompare(b)) : arr;
}

/** Map a raw CT.gov v2 study payload (full or `fields`-limited) into the lean shape. */
export function mapStudy(study: RawStudy): MappedTrial {
  const p = study.protocolSection ?? {};
  const design = p.designModule ?? {};
  const sponsorMod = p.sponsorCollaboratorsModule ?? {};
  const armsMod = p.armsInterventionsModule ?? {};
  const locMod = p.contactsLocationsModule ?? {};
  const condMod = p.conditionsModule ?? {};

  return {
    nct_id: p.identificationModule?.nctId,
    phase: Array.isArray(design.phases) && design.phases.length ? design.phases.join(", ") : null,
    sponsor: sponsorMod.leadSponsor?.name ?? null,
    lead_sponsor_class: sponsorMod.leadSponsor?.class ?? null,
    conditions: uniqTrimmed(Array.isArray(condMod.conditions) ? condMod.conditions : []),
    interventions: uniqTrimmed(
      (armsMod.interventions ?? [])
        .filter((iv: any) => PRODUCT_INTERVENTION_TYPES.has(String(iv?.type ?? "").toUpperCase()))
        .map((iv: any) => iv?.name),
    ),
    countries: uniqTrimmed((locMod.locations ?? []).map((l: any) => l?.country), true),
  };
}
