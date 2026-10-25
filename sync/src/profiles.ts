// Research files -> drug pages (development, regulatory and commercial profile).
//
// Reads sync/data/profiles/*.json. Each file lists drugs with
//   fields      INN, API, regulatory status, designations, patents, anticipated launch,
//               efficacy and safety signal (and, if given, any other profile field such as phase)
//               -> products.curated_info {field: {value, source, url}}. The website shows a value
//               typed on the drug page first, then this, then the automatic value (auto_info).
//   results     efficacy / safety results            -> product_results   (origin 'curated')
//   milestones  regulatory steps, readouts, launches,  -> product_milestones (origin 'curated')
//               patent expiries, inflection points, upcoming milestones
// Re-running is safe: curated rows are matched by a stable key and updated, rows no longer in any
// file are removed, a row an editor hid on the website stays hidden, and rows added on the website
// (origin 'manual') are never touched. A drug that has no page yet is skipped and reported.

import { readdirSync, readFileSync } from "node:fs";
import { pool, withTransaction } from "./db.js";
import { productNameIndex } from "./abstracts.js";

export const PROFILE_FIELDS = [
  "inn", "api", "regulatory_status", "designations", "patents", "anticipated_launch", "efficacy_signal", "safety_signal",
  // existing profile fields a research file may also give (e.g. a phase newer than the databases know)
  "aliases", "brand_names", "candidate", "parent_drug", "sponsor", "drug_class", "therapy_subclass", "indication",
  "modality", "phase", "moa", "roa", "approved", "approval_date",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface SourceRef { label?: string; url?: string }
export interface ProfileResult {
  kind: "efficacy" | "safety";
  trial?: string; phase?: string; population?: string; duration?: string; dose?: string;
  endpoint?: string; result: string; comparator?: string; reported?: string; source?: SourceRef;
}
export const MILESTONE_KINDS = ["regulatory", "readout", "launch", "patent", "inflection", "milestone"] as const;
export const MILESTONE_STATUSES = ["done", "expected", "delayed", "cancelled"] as const;
export interface ProfileMilestone {
  kind: (typeof MILESTONE_KINDS)[number];
  title: string; detail?: string; date?: string | null; status?: (typeof MILESTONE_STATUSES)[number];
  region?: string; source?: SourceRef;
}
export interface ProfileDrug {
  name: string;
  aliases?: string[];
  fields?: Partial<Record<ProfileField, string>>;
  sources?: SourceRef[];
  results?: ProfileResult[];
  milestones?: ProfileMilestone[];
}
export interface ProfileFile { source: string; updated?: string; description?: string; drugs: ProfileDrug[] }

const DATA_DIR = new URL("../data/profiles/", import.meta.url);

export function loadProfileFiles(): ProfileFile[] {
  let names: string[] = [];
  try { names = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  return names.map((f) => JSON.parse(readFileSync(new URL(f, DATA_DIR), "utf8")) as ProfileFile)
    .filter((f) => f?.source && Array.isArray(f.drugs));
}

/**
 * First day of the period a date label names, for sorting: "2026-03-19" -> 2026-03-19,
 * "2026-03" -> 2026-03-01, "2026-Q4" -> 2026-10-01, "2026-H2" -> 2026-07-01, "2027" -> 2027-01-01.
 */
export function dateSort(label: string | null | undefined): string | null {
  const s = (label ?? "").trim().toUpperCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{4})-?Q([1-4])$/.exec(s);
  if (m) return `${m[1]}-${String((+m[2] - 1) * 3 + 1).padStart(2, "0")}-01`;
  m = /^(\d{4})-?H([12])$/.exec(s);
  if (m) return `${m[1]}-${m[2] === "1" ? "01" : "07"}-01`;
  m = /^(\d{4})$/.exec(s);
  if (m) return `${m[1]}-01-01`;
  return null;
}

const keyText = (...xs: (string | null | undefined)[]) =>
  xs.map((x) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|").slice(0, 300);
export const resultKey = (r: ProfileResult) => keyText(r.kind, r.trial, r.endpoint, r.dose);
export const milestoneKey = (m: ProfileMilestone) => keyText(m.kind, m.title);
const clip = (v: unknown, n = 1000) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };

export interface ProfileImportResult { files: number; drugs: number; fields: number; results: number; milestones: number; removed: number; unresolved: string[] }

export async function importProfiles(
  files: ProfileFile[] = loadProfileFiles(), log: (m: string, o?: unknown) => void = () => {},
): Promise<ProfileImportResult> {
  const res: ProfileImportResult = { files: files.length, drugs: 0, fields: 0, results: 0, milestones: 0, removed: 0, unresolved: [] };
  const { resolve } = await productNameIndex();

  // Later files win for the same field; results and milestones are added up.
  const info = new Map<string, Record<string, { value: string; source: string; url?: string; curated: true }>>();
  const results: { slug: string; key: string; r: ProfileResult; sort: number }[] = [];
  const milestones: { slug: string; key: string; m: ProfileMilestone }[] = [];
  for (const f of files) {
    for (const d of f.drugs) {
      const slug = resolve({ name: d.name, aliases: d.aliases });
      if (!slug) { res.unresolved.push(d.name); continue; }
      res.drugs++;
      const src = d.sources?.[0];
      const fieldsOut = info.get(slug) ?? {};
      for (const [k, v] of Object.entries(d.fields ?? {})) {
        if (!(PROFILE_FIELDS as readonly string[]).includes(k)) continue;
        const value = clip(v, 1000);
        if (!value) continue;
        fieldsOut[k] = { value, source: src?.label ? `${f.source}: ${src.label}` : f.source, ...(src?.url ? { url: src.url } : {}), curated: true };
      }
      info.set(slug, fieldsOut);
      (d.results ?? []).forEach((r, i) => {
        if (!r?.result || (r.kind !== "efficacy" && r.kind !== "safety")) return;
        results.push({ slug, key: resultKey(r), r, sort: i });
      });
      for (const m of d.milestones ?? []) {
        if (!m?.title || !(MILESTONE_KINDS as readonly string[]).includes(m.kind)) continue;
        milestones.push({ slug, key: milestoneKey(m), m });
      }
    }
  }

  await withTransaction(async (c) => {
    // Profile fields: every drug in a file gets its set; drugs no longer in any file lose theirs.
    const slugs = [...info.keys()];
    for (const [slug, fields] of info) {
      const upd = await c.query(
        `UPDATE products SET curated_info = $2::jsonb, curated_updated_at = now()
          WHERE slug = $1 AND curated_info IS DISTINCT FROM $2::jsonb`,
        [slug, JSON.stringify(fields)],
      );
      if (upd.rowCount) res.fields += Object.keys(fields).length;
    }
    await c.query("UPDATE products SET curated_info = NULL, curated_updated_at = now() WHERE curated_info IS NOT NULL AND NOT (slug = ANY($1))", [slugs]);

    // Results
    const seenR = new Set<string>();
    for (const { slug, key, r, sort } of results) {
      if (seenR.has(`${slug}\u001f${key}`)) continue;
      seenR.add(`${slug}\u001f${key}`);
      await c.query(
        `INSERT INTO product_results (product_slug, kind, trial, phase, population, duration, dose, endpoint, result, comparator,
                                      reported, source_label, source_url, origin, curated_key, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'curated', $14, $15)
         ON CONFLICT (product_slug, curated_key) WHERE curated_key IS NOT NULL DO UPDATE SET
           kind = EXCLUDED.kind, trial = EXCLUDED.trial, phase = EXCLUDED.phase, population = EXCLUDED.population,
           duration = EXCLUDED.duration, dose = EXCLUDED.dose, endpoint = EXCLUDED.endpoint, result = EXCLUDED.result,
           comparator = EXCLUDED.comparator, reported = EXCLUDED.reported, source_label = EXCLUDED.source_label,
           source_url = EXCLUDED.source_url, sort = EXCLUDED.sort, origin = 'curated',
           updated_at = CASE WHEN (product_results.result, product_results.comparator, product_results.reported, product_results.population,
                                   product_results.source_url) IS DISTINCT FROM
                                  (EXCLUDED.result, EXCLUDED.comparator, EXCLUDED.reported, EXCLUDED.population, EXCLUDED.source_url)
                             THEN now() ELSE product_results.updated_at END`,
        [slug, r.kind, clip(r.trial, 200), clip(r.phase, 100), clip(r.population, 300), clip(r.duration, 100), clip(r.dose, 200),
         clip(r.endpoint, 200), clip(r.result, 500), clip(r.comparator, 300), clip(r.reported, 40), clip(r.source?.label, 200),
         clip(r.source?.url, 1000), key, sort],
      );
      res.results++;
    }
    // Milestones
    const seenM = new Set<string>();
    for (const { slug, key, m } of milestones) {
      if (seenM.has(`${slug}\u001f${key}`)) continue;
      seenM.add(`${slug}\u001f${key}`);
      const status = (MILESTONE_STATUSES as readonly string[]).includes(m.status ?? "") ? m.status : "expected";
      await c.query(
        `INSERT INTO product_milestones (product_slug, kind, title, detail, date_label, date_sort, status, region,
                                         source_label, source_url, origin, curated_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'curated', $11)
         ON CONFLICT (product_slug, curated_key) WHERE curated_key IS NOT NULL DO UPDATE SET
           kind = EXCLUDED.kind, title = EXCLUDED.title, detail = EXCLUDED.detail, date_label = EXCLUDED.date_label,
           date_sort = EXCLUDED.date_sort, status = EXCLUDED.status, region = EXCLUDED.region,
           source_label = EXCLUDED.source_label, source_url = EXCLUDED.source_url, origin = 'curated',
           updated_at = CASE WHEN (product_milestones.date_label, product_milestones.status, product_milestones.detail, product_milestones.region)
                                  IS DISTINCT FROM (EXCLUDED.date_label, EXCLUDED.status, EXCLUDED.detail, EXCLUDED.region)
                             THEN now() ELSE product_milestones.updated_at END`,
        [slug, m.kind, clip(m.title, 300), clip(m.detail, 1000), clip(m.date, 20), dateSort(m.date), status, clip(m.region, 120),
         clip(m.source?.label, 200), clip(m.source?.url, 1000), key],
      );
      res.milestones++;
    }
    // Curated rows that are no longer in any file
    const delR = await c.query(
      `DELETE FROM product_results WHERE origin = 'curated'
          AND NOT (product_slug || chr(31) || coalesce(curated_key, '') = ANY($1))`,
      [[...seenR]],
    );
    const delM = await c.query(
      `DELETE FROM product_milestones WHERE origin = 'curated'
          AND NOT (product_slug || chr(31) || coalesce(curated_key, '') = ANY($1))`,
      [[...seenM]],
    );
    res.removed = (delR.rowCount ?? 0) + (delM.rowCount ?? 0);
  });

  if (res.unresolved.length) log(`Research files: ${res.unresolved.length} drug(s) without a drug page (skipped)`, res.unresolved);
  return res;
}

/** Profile fields only (no database), for checking a file before it is committed. */
export function checkProfileFile(f: ProfileFile): string[] {
  const problems: string[] = [];
  for (const d of f.drugs ?? []) {
    if (!d.name) problems.push("a drug without a name");
    for (const k of Object.keys(d.fields ?? {})) if (!(PROFILE_FIELDS as readonly string[]).includes(k)) problems.push(`${d.name}: unknown field "${k}"`);
    for (const r of d.results ?? []) {
      if (r.kind !== "efficacy" && r.kind !== "safety") problems.push(`${d.name}: result kind "${r.kind}"`);
      if (!r.result) problems.push(`${d.name}: result without a value (${r.trial ?? "?"})`);
    }
    for (const m of d.milestones ?? []) {
      if (!(MILESTONE_KINDS as readonly string[]).includes(m.kind)) problems.push(`${d.name}: milestone kind "${m.kind}"`);
      if (m.status && !(MILESTONE_STATUSES as readonly string[]).includes(m.status)) problems.push(`${d.name}: milestone status "${m.status}"`);
      if (m.date && !dateSort(m.date)) problems.push(`${d.name}: milestone date "${m.date}" (use 2026-03-19, 2026-03, 2026-Q4, 2026-H2 or 2026)`);
    }
  }
  return problems;
}

/** How much the research files currently fill (drugs with fields, result rows, milestone rows). */
export async function curatedCounts(): Promise<{ drugs: number; results: number; milestones: number }> {
  const r = await pool.query<{ drugs: number; results: number; milestones: number }>(
    `SELECT (SELECT count(*)::int FROM products WHERE curated_info IS NOT NULL) AS drugs,
            (SELECT count(*)::int FROM product_results WHERE origin = 'curated') AS results,
            (SELECT count(*)::int FROM product_milestones WHERE origin = 'curated') AS milestones`,
  );
  return r.rows[0];
}
