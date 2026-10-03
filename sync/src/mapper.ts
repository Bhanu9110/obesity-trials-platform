import { createHash } from "node:crypto";
import type { RawStudy } from "./ctgov-client.js";

// Version of the CT.gov parser (trimPayload + mapStudy). Bump it whenever the
// mapping changes: stored raw records with an older version are re-parsed from
// raw_trials automatically — no re-download needed.
export const PARSER_VERSION = "ctgov-2.1"; // 2.1: validation + clean-up of every record

// Intervention types that count as drug PRODUCTS. Behavioural, device, procedure,
// dietary-supplement and "other" interventions are not stored.
export const PRODUCT_INTERVENTION_TYPES = new Set(["DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT"]);

// The only fields kept per trial: phase, sponsor, indication, interventions,
// location (countries; continents are derived in the database), plus the
// registry's own last-update date.
export interface MappedTrial {
  nct_id: string;
  phase: string | null;              // "PHASE2" or "PHASE2, PHASE3"
  sponsor: string | null;            // lead sponsor name
  lead_sponsor_class: string | null; // INDUSTRY | NIH | OTHER ...
  conditions: string[];              // indication(s)
  interventions: string[];           // drug intervention names as registered
  countries: string[];               // distinct site countries
  source_updated_at: string | null;  // CT.gov "last update posted" date, YYYY-MM-DD
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

/** CT.gov dates come as YYYY, YYYY-MM or YYYY-MM-DD. Normalise to a full date. */
export function normalizeDate(v?: string | null): string | null {
  if (!v || !/^\d{4}(-\d{2}){0,2}$/.test(v)) return null;
  const parts = v.split("-");
  if (parts.length === 1) return `${parts[0]}-01-01`;
  if (parts.length === 2) return `${parts[0]}-${parts[1]}-01`;
  return v;
}

/**
 * Reduce a CT.gov v2 record (full, or already `fields`-limited) to exactly the
 * fields this platform ingests. This is what raw_trials stores and hashes, so
 * the content hash is the same whichever way the record was downloaded, and
 * mapStudy() gives identical results on the stored copy (re-parse support).
 */
export function trimPayload(study: RawStudy): RawStudy {
  const p = study?.protocolSection ?? {};
  const pick = <T>(v: T | undefined | null) => (v === undefined || v === null ? undefined : v);
  const trimmed = {
    protocolSection: {
      identificationModule: { nctId: pick(p.identificationModule?.nctId), briefTitle: pick(p.identificationModule?.briefTitle) },
      statusModule: {
        lastUpdatePostDateStruct: pick(
          p.statusModule?.lastUpdatePostDateStruct?.date !== undefined
            ? { date: p.statusModule.lastUpdatePostDateStruct.date }
            : undefined,
        ),
      },
      designModule: { phases: pick(p.designModule?.phases) },
      sponsorCollaboratorsModule: {
        leadSponsor: pick(
          p.sponsorCollaboratorsModule?.leadSponsor
            ? { name: pick(p.sponsorCollaboratorsModule.leadSponsor.name), class: pick(p.sponsorCollaboratorsModule.leadSponsor.class) }
            : undefined,
        ),
      },
      conditionsModule: { conditions: pick(p.conditionsModule?.conditions) },
      armsInterventionsModule: {
        interventions: pick(
          Array.isArray(p.armsInterventionsModule?.interventions)
            ? p.armsInterventionsModule.interventions.map((iv: any) => ({ type: pick(iv?.type), name: pick(iv?.name) }))
            : undefined,
        ),
      },
      contactsLocationsModule: {
        locations: pick(
          Array.isArray(p.contactsLocationsModule?.locations)
            ? p.contactsLocationsModule.locations.map((l: any) => ({ country: pick(l?.country) }))
            : undefined,
        ),
      },
    },
  };
  // Drop undefined keys so the canonical JSON (and hash) is stable.
  return JSON.parse(JSON.stringify(trimmed));
}

/** JSON with object keys sorted at every level (stable for hashing). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).filter((k) => (v as any)[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** sha256 of the canonical JSON of any value (raw payloads, mapped records). */
export function contentHash(v: unknown): string {
  return sha256(canonicalJson(v));
}

/** Map a CT.gov v2 study payload (full, `fields`-limited or trimmed) into the lean shape. */
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
    source_updated_at: normalizeDate(p.statusModule?.lastUpdatePostDateStruct?.date),
  };
}

/** The registry's brief title (used only to classify industry trials; not displayed). */
export function studyTitle(study: RawStudy): string | null {
  const t = study?.protocolSection?.identificationModule?.briefTitle;
  return typeof t === "string" && t.trim() ? t.replace(/\s+/g, " ").trim().slice(0, 500) : null;
}
