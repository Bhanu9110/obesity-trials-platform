// Which "products" are really drugs (sync/data/product-curation.json + name rules).
//
// Trial registrations list diets, procedures, tests and supplements as interventions, so
// they became drug pages ("Caloric Restriction", "Blood Tests", "Green Tea"). They stay in
// the database — the trials still name them — but products.kind keeps them out of the drug
// list, the dashboard counts, search and the auto-fill. Duplicate pages of one drug
// ("Metformine", "Metfomin") are merged, the same way "Merge" on a drug page does it.
//
//   1. a choice made on the drug page (kind_source = 'manual') always wins;
//   2. the reviewed list in sync/data/product-curation.json (kind_source = 'list');
//   3. name rules for new entries (kind_source = 'rule'), e.g. "... surgery", "placebo", "MRI".

import { readFileSync } from "node:fs";
import { pool, withTransaction, type Client } from "./db.js";
import { slugify } from "./products.js";

export type ProductKind = "supplement" | "not_drug";

export interface Curation {
  not_drug: Record<string, string>;     // slug -> "Name" or "Name — why"
  supplement: Record<string, string>;
  drug: string[];                        // slugs that must stay drugs whatever the rules say
  merge: Record<string, { into: string; name: string }>;
}

export function loadCuration(): Curation {
  try {
    const j = JSON.parse(readFileSync(new URL("../data/product-curation.json", import.meta.url), "utf8"));
    return { not_drug: j.not_drug ?? {}, supplement: j.supplement ?? {}, drug: j.drug ?? [], merge: j.merge ?? {} };
  } catch {
    return { not_drug: {}, supplement: {}, drug: [], merge: {} };
  }
}

// Words that only appear in names of things that are not drugs. Applied to single names
// only ("Behavioral + Orlistat" is a drug arm): checked against the 892 reviewed drug
// names, none of which matches.
const NOT_DRUG_RE = new RegExp(String.raw`\b(placebo|placibo|sham|usual care|standard (of )?care|no (intervention|treatment)|wait-?list|control group|normal control|surgery|surgical procedure|gastrectomy|gastric by-?pass|roux-en-y|gastroplasty|gastric band\w*|intragastric balloon|bariatric|f?mri|dxa|dexa|ultrasound|echocardiography|electroencephalography|calorimetry|biopsy|endoscopy|gastroscopy|gastroduodenoscopy|laryngoscopy|bioimpedance|blood (tests?|analysis|sampling|draw)|questionnaire|interview|diary|scale|monitoring|assessment|evaluation|analysis|measurement|sampling|calibration|exploration|exercise|physical activity|training|coaching|counsel+ing|lifestyle|yoga|acupuncture|mindfulness|cbt|psychotherapy|education|diets?|dietary|fasting|caloric restriction|calorie restriction|energy restriction|meal replacement|time-restricted|transplant(ation)?|cold exposure)\b`, "i");

/** Kind from the name alone: 'not_drug' for clear cases, else null (= drug). */
export function kindFromName(name: string): { kind: ProductKind; note: string } | null {
  if (!name || name.includes(" + ")) return null;
  const m = NOT_DRUG_RE.exec(name);
  return m ? { kind: "not_drug", note: `name rule: "${m[0].toLowerCase()}"` } : null;
}

const MANUAL_FIELDS = [
  "modality", "phase", "moa", "roa", "approved", "approval_date", "sponsor", "drug_class", "aliases",
  "brand_names", "candidate", "parent_drug", "therapy_subclass", "indication", "summary",
] as const;

/**
 * Merge one drug page into another (creating the target when needed): trial links, conference
 * abstracts, any hand-entered field the target lacks, and an alias so product rebuilds keep it merged.
 */
export async function mergeProductRows(c: Client, fromSlug: string, intoSlug: string, intoName: string): Promise<boolean> {
  await c.query(
    `INSERT INTO product_aliases (alias_slug, product_slug, product_name) VALUES ($1, $2, $3)
     ON CONFLICT (alias_slug) DO UPDATE SET product_slug = EXCLUDED.product_slug, product_name = EXCLUDED.product_name`,
    [fromSlug, intoSlug, intoName],
  );
  await c.query("UPDATE product_aliases SET product_slug = $2, product_name = $3 WHERE product_slug = $1", [fromSlug, intoSlug, intoName]);
  const from = (await c.query("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [fromSlug])).rows[0];
  if (!from) return false;
  await c.query("INSERT INTO products (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING", [intoSlug, intoName]);
  const into = (await c.query("SELECT id FROM products WHERE slug = $1 FOR UPDATE", [intoSlug])).rows[0];
  await c.query(
    `INSERT INTO trial_products (nct_id, product_id) SELECT nct_id, $2 FROM trial_products WHERE product_id = $1 ON CONFLICT DO NOTHING`,
    [from.id, into.id],
  );
  await c.query(
    `UPDATE products t SET ${MANUAL_FIELDS.map((f) => `${f} = coalesce(t.${f}, f.${f})`).join(", ")}
       FROM products f WHERE t.id = $2 AND f.id = $1`,
    [from.id, into.id],
  );
  await c.query(
    `INSERT INTO product_abstracts (product_slug, source, abstract_no, drug_name, aliases)
     SELECT $2, source, abstract_no, drug_name, aliases FROM product_abstracts WHERE product_slug = $1 ON CONFLICT DO NOTHING`,
    [fromSlug, intoSlug],
  );
  await c.query("DELETE FROM product_abstracts WHERE product_slug = $1", [fromSlug]);
  await c.query("DELETE FROM products WHERE id = $1", [from.id]);
  return true;
}

export interface CurationResult {
  merged: number;
  listed: { not_drug: number; supplement: number };
  byRule: string[];   // names newly hidden by a name rule (worth a look)
}

export async function applyCuration(cur: Curation = loadCuration(), log: (m: string, o?: unknown) => void = () => {}): Promise<CurationResult> {
  const res: CurationResult = { merged: 0, listed: { not_drug: 0, supplement: 0 }, byRule: [] };
  await withTransaction(async (c) => {
    // 1. Duplicates (targets that are themselves merged elsewhere are followed).
    const target = (s: string, seen = new Set<string>()): { into: string; name: string } => {
      const m = cur.merge[s];
      if (!m || seen.has(s)) return { into: s, name: "" };
      seen.add(s);
      const next = cur.merge[m.into] ? target(m.into, seen) : m;
      return { into: next.into, name: next.name || m.name };
    };
    for (const from of Object.keys(cur.merge)) {
      const t = target(from);
      if (t.into !== from && (await mergeProductRows(c, from, t.into, t.name))) res.merged++;
    }

    // 2. The reviewed list. A choice made on a drug page is never overridden.
    for (const kind of ["not_drug", "supplement"] as const) {
      const slugs = Object.keys(cur[kind]);
      if (!slugs.length) continue;
      await c.query(
        `UPDATE products p SET kind = $1, kind_source = 'list', kind_note = n.note
           FROM unnest($2::text[], $3::text[]) AS n(slug, note)
          WHERE p.slug = n.slug AND p.kind_source IS DISTINCT FROM 'manual'
            AND (p.kind IS DISTINCT FROM $1 OR p.kind_source IS DISTINCT FROM 'list' OR p.kind_note IS DISTINCT FROM n.note)`,
        // the file says "Name" or "Name — why": keep the why
        [kind, slugs, slugs.map((s) => cur[kind][s]?.split(" — ").slice(1).join(" — ") || null)],
      );
      res.listed[kind] = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM products WHERE kind = $1", [kind])).rows[0].n;
    }
    // Taken off the list since: back in the drug list (the name rules below may still apply).
    const listed = [...Object.keys(cur.not_drug), ...Object.keys(cur.supplement)];
    await c.query(
      `UPDATE products SET kind = NULL, kind_source = NULL, kind_note = NULL
        WHERE kind_source = 'list' AND kind IS NOT NULL AND NOT (slug = ANY($1))`,
      [listed],
    );
    if (cur.drug.length) {
      await c.query(
        `UPDATE products SET kind = NULL, kind_source = 'list', kind_note = NULL
          WHERE slug = ANY($1) AND kind_source IS DISTINCT FROM 'manual'`,
        [cur.drug.map(slugify)],
      );
    }

    // 3. Name rules for entries nobody has decided on yet.
    const open = await c.query<{ id: number; name: string }>(
      "SELECT id, name FROM products WHERE kind IS NULL AND kind_source IS NULL",
    );
    for (const p of open.rows) {
      const k = kindFromName(p.name);
      if (!k) continue;
      await c.query("UPDATE products SET kind = $2, kind_source = 'rule', kind_note = $3 WHERE id = $1", [p.id, k.kind, k.note]);
      res.byRule.push(p.name);
    }
  });
  if (res.merged || res.byRule.length) log("Drug list clean-up", { merged: res.merged, hiddenByRule: res.byRule });
  return res;
}

/** Product slugs the reviewed list or the name rules keep out of the drug list (for tests). */
export async function hiddenSlugs(): Promise<string[]> {
  return (await pool.query<{ slug: string }>("SELECT slug FROM products WHERE kind IS NOT NULL ORDER BY slug")).rows.map((r) => r.slug);
}
