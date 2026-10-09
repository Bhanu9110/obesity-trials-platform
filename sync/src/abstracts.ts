// Conference abstracts (e.g. ADA 2026) -> drug pages.
//
// Reads sync/data/conference/*.json (one file per meeting), stores every abstract in
// conference_abstracts and links it to the drug pages it names (product_abstracts). A drug
// that is not in the database yet (no ClinicalTrials.gov trial — typical for preclinical
// programs) gets a new drug page. Re-running is safe: each meeting's rows are replaced.

import { readdirSync, readFileSync } from "node:fs";
import { pool, withTransaction } from "./db.js";
import { BUILTIN_ALIASES, slugify } from "./products.js";

export interface AbstractDrug { name: string; aliases?: string[]; create?: boolean }
export interface ConferenceAbstract {
  abstract_no: string;
  program?: string | null;
  drugs: AbstractDrug[];
  sponsor?: string | null;
  sponsor_basis?: string | null;
  indication?: string | null;
  stage?: string | null;
  mechanism?: string | null;
  model?: string | null;
  key_finding?: string | null;
  title?: string | null;
  link?: string | null;
  trials?: string[];         // clinical trial(s) reported: NCT IDs or trial names ("ACCESS II")
  study_type?: string | null; // "Clinical trial" | "Post hoc analysis of SELECT" | ...
}
export interface ConferenceFile { source: string; description?: string; url?: string; abstracts: ConferenceAbstract[] }

const DATA_DIR = new URL("../data/conference/", import.meta.url);

export function loadConferenceFiles(): ConferenceFile[] {
  let names: string[] = [];
  try { names = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  return names.map((f) => JSON.parse(readFileSync(new URL(f, DATA_DIR), "utf8")) as ConferenceFile)
    .filter((f) => f?.source && Array.isArray(f.abstracts));
}

/** Product slug for a drug name, the way trial interventions are turned into drugs ("A + B" -> "a_b"). */
export function slugForName(name: string): { slug: string; name: string } {
  const parts = name.split(" + ").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { slug: slugify(name), name: name.trim() };
  const sorted = parts.map((p) => ({ slug: slugify(p), name: p })).sort((a, b) => a.slug.localeCompare(b.slug));
  return { slug: sorted.map((p) => p.slug).join("_"), name: sorted.map((p) => p.name).join(" + ") };
}

const NCT_RE = /^NCT\d{8}$/i;

/**
 * The trials each abstract reports, one ID per trial: an abstract naming a trial and its NCT ID
 * ("ENLIGHT; NCT06921486") reports one trial, so the name is replaced by the NCT ID — also in other
 * abstracts of the same meeting that give only the name.
 */
export function canonicalTrials(abstracts: ConferenceAbstract[]): Map<string, string[]> {
  const clean = (a: ConferenceAbstract) => (a.trials ?? []).map((t) => t.trim()).filter(Boolean)
    .map((t) => (NCT_RE.test(t) ? t.toUpperCase() : t));
  const nctOf = new Map<string, string>(); // trial name (lower case) -> NCT ID
  for (const a of abstracts) {
    const ids = clean(a), ncts = ids.filter((t) => NCT_RE.test(t)), names = ids.filter((t) => !NCT_RE.test(t));
    if (ncts.length === 1 && names.length === 1) nctOf.set(names[0].toLowerCase(), ncts[0]);
  }
  const out = new Map<string, string[]>();
  for (const a of abstracts) {
    const ids = clean(a);
    const ncts = ids.filter((t) => NCT_RE.test(t));
    const named = ids.filter((t) => !NCT_RE.test(t)).map((t) => nctOf.get(t.toLowerCase()) ?? t);
    // As many NCT IDs as names ("ENLIGHT; NCT06921486"): the names are those same trials.
    const sameTrials = ncts.length > 0 && ncts.length >= ids.length - ncts.length;
    const list = sameTrials ? [...ncts, ...named.filter((n) => NCT_RE.test(n))] : [...ncts, ...named];
    out.set(a.abstract_no, [...new Set(list)]);
  }
  return out;
}

export interface ImportResult { sources: number; abstracts: number; links: number; created: string[] }

export async function importAbstracts(
  files: ConferenceFile[] = loadConferenceFiles(), log: (m: string, o?: unknown) => void = () => {},
): Promise<ImportResult> {
  const res: ImportResult = { sources: 0, abstracts: 0, links: 0, created: [] };
  if (!files.length) return res;

  // Every name a drug page is known by. Most trusted first: the page's own name wins.
  const owner = new Map<string, string>();
  const put = (k: string, slug: string) => { const s = slugify(k); if (s && !owner.has(s)) owner.set(s, slug); };
  const prods = await pool.query<{ slug: string; name: string; aliases: string | null; auto: string | null }>(
    "SELECT slug, name, aliases, auto_info #>> '{aliases,value}' AS auto FROM products",
  );
  const pages = new Set(prods.rows.map((p) => p.slug)); // combination pages have "_" in the slug
  for (const p of prods.rows) { put(p.slug, p.slug); put(p.name, p.slug); }
  for (const [k, ref] of Object.entries(BUILTIN_ALIASES)) put(k, ref.slug);
  for (const r of (await pool.query<{ alias_slug: string; product_slug: string }>("SELECT alias_slug, product_slug FROM product_aliases")).rows) put(r.alias_slug, r.product_slug);
  try {
    for (const r of (await pool.query<{ alias: string; product_slug: string }>("SELECT alias, product_slug FROM pipeline_code_names")).rows) put(r.alias, r.product_slug);
  } catch { /* table not created yet */ }
  for (const p of prods.rows) for (const x of (p.aliases ?? "").split(/[,;]\s*/)) put(x, p.slug);
  for (const p of prods.rows) for (const x of (p.auto ?? "").split(/[,;]\s*/)) put(x, p.slug);

  const resolve = (d: AbstractDrug): string | null => {
    const own = slugForName(d.name).slug;
    if (pages.has(own)) return own;
    for (const k of [own, ...(d.aliases ?? []).map(slugify)]) if (owner.has(k)) return owner.get(k)!;
    return null;
  };

  await withTransaction(async (c) => {
    for (const f of files) {
      res.sources++;
      await c.query("DELETE FROM conference_abstracts WHERE source = $1", [f.source]); // cascades the links
      const trialsOf = canonicalTrials(f.abstracts);
      for (const a of f.abstracts) {
        if (!a.abstract_no || !a.drugs?.length) continue;
        await c.query(
          `INSERT INTO conference_abstracts (source, abstract_no, title, link, program, sponsor, sponsor_basis, indication,
                                             stage, mechanism, model, key_finding, trial_ids, study_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [f.source, a.abstract_no, a.title ?? null, a.link ?? null, a.program ?? null, a.sponsor ?? null, a.sponsor_basis ?? null,
           a.indication ?? null, a.stage ?? null, a.mechanism ?? null, a.model ?? null, a.key_finding ?? null,
           trialsOf.get(a.abstract_no) ?? [], a.study_type ?? null],
        );
        res.abstracts++;
        for (const d of a.drugs) {
          let slug = resolve(d);
          if (!slug) {
            if (d.create === false) continue; // background drug that isn't tracked: no new page for it
            const ref = slugForName(d.name);
            const ins = await c.query("INSERT INTO products (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", [ref.slug, ref.name]);
            pages.add(ref.slug);
            owner.set(ref.slug, ref.slug);
            for (const al of d.aliases ?? []) put(al, ref.slug);
            if (ins.rowCount) res.created.push(ref.name);
            slug = ref.slug;
          }
          const ins = await c.query(
            `INSERT INTO product_abstracts (product_slug, source, abstract_no, drug_name, aliases)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [slug, f.source, a.abstract_no, d.name, d.aliases ?? []],
          );
          res.links += ins.rowCount ?? 0;
        }
      }
    }
  });
  if (res.created.length) log(`Conference abstracts: ${res.created.length} new drug pages`, res.created);
  return res;
}
