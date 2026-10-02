import { query, pool } from "./db";
import type {
  FilterOptions,
  Product,
  ProductInfo,
  ProductSummary,
  ProductTrial,
  TrialListItem,
} from "./types";
import { CONTINENT_ORDER, phaseRank } from "./format";

export interface TrialFilters {
  q?: string;
  phase?: string[];
  continent?: string[];
  country?: string[];
  sponsorClass?: string[];
  page?: number;
  pageSize?: number;
}

// Products of a trial as [{slug, name}], alphabetical.
const PRODUCTS_JSON = `
  coalesce((SELECT json_agg(json_build_object('slug', p.slug, 'name', p.name) ORDER BY p.name)
              FROM trial_products tp JOIN products p ON p.id = tp.product_id
             WHERE tp.nct_id = t.nct_id), '[]'::json)`;

function buildWhere(f: TrialFilters, params: unknown[]): string {
  const clauses: string[] = ["t.is_active = true"];
  if (f.q) {
    // Keyword search across every stored field + drug names.
    params.push(`%${f.q}%`);
    const i = params.length;
    clauses.push(`(
      t.nct_id ILIKE $${i}
      OR coalesce(t.sponsor, '') ILIKE $${i}
      OR array_to_string(t.conditions, ' ') ILIKE $${i}
      OR array_to_string(t.interventions, ' ') ILIKE $${i}
      OR array_to_string(t.countries, ' ') ILIKE $${i}
      OR EXISTS (SELECT 1 FROM trial_products tp JOIN products p ON p.id = tp.product_id
                  WHERE tp.nct_id = t.nct_id AND p.name ILIKE $${i})
    )`);
  }
  if (f.phase?.length) {
    params.push(f.phase);
    clauses.push(`t.phase = ANY($${params.length})`);
  }
  if (f.country?.length) {
    params.push(f.country);
    clauses.push(`t.countries && $${params.length}::text[]`);
  } else if (f.continent?.length) {
    params.push(f.continent);
    clauses.push(`t.continents && $${params.length}::text[]`);
  }
  if (f.sponsorClass?.length) {
    params.push(f.sponsorClass);
    clauses.push(`t.lead_sponsor_class = ANY($${params.length})`);
  }
  return "WHERE " + clauses.join(" AND ");
}

export async function listTrials(
  f: TrialFilters,
): Promise<{ items: TrialListItem[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 20));
  const params: unknown[] = [];
  const where = buildWhere(f, params);

  const countRows = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM trials t ${where}`,
    params,
  );
  const total = countRows[0]?.count ?? 0;

  params.push(pageSize, (page - 1) * pageSize);
  const items = await query<TrialListItem>(
    `SELECT t.nct_id, t.phase, t.sponsor, t.conditions AS indication, t.continents,
            ${PRODUCTS_JSON} AS products
       FROM trials t ${where}
      ORDER BY t.nct_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total };
}

export async function filterOptions(): Promise<FilterOptions> {
  const [phases, countries] = await Promise.all([
    query<{ phase: string }>(
      `SELECT DISTINCT phase FROM trials WHERE is_active AND coalesce(phase, '') <> ''`,
    ),
    query<{ country: string; continent: string }>(
      `SELECT c AS country, continent_of(c) AS continent
         FROM (SELECT DISTINCT unnest(countries) AS c FROM trials WHERE is_active) x
        ORDER BY c`,
    ),
  ]);
  const byContinent = new Map<string, string[]>();
  for (const r of countries) {
    const list = byContinent.get(r.continent) ?? [];
    list.push(r.country);
    byContinent.set(r.continent, list);
  }
  return {
    phases: phases.map((p) => p.phase).sort((a, b) => phaseRank(a) - phaseRank(b) || a.localeCompare(b)),
    continents: CONTINENT_ORDER.filter((c) => byContinent.has(c)).map((c) => ({
      name: c,
      countries: byContinent.get(c)!,
    })),
  };
}

// --------------------------------------------------------------------------- #
// Products (drug pages)
// --------------------------------------------------------------------------- #
const INFO_COLS = `p.modality, p.phase, p.moa, p.roa, p.approved,
  to_char(p.approval_date, 'YYYY-MM-DD') AS approval_date, p.sponsor, p.drug_class`;

export async function listProducts(): Promise<ProductSummary[]> {
  return query<ProductSummary>(
    `SELECT p.slug, p.name, ${INFO_COLS},
            count(t.nct_id)::int AS trials,
            coalesce(array_agg(DISTINCT t.phase) FILTER (WHERE t.phase IS NOT NULL), '{}') AS trial_phases,
            (p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
             OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL
             OR p.drug_class IS NOT NULL) AS has_info
       FROM products p
       JOIN trial_products tp ON tp.product_id = p.id
       JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
      GROUP BY p.id
      ORDER BY trials DESC, p.name`,
  );
}

export async function getProduct(slug: string): Promise<Product | null> {
  const rows = await query<Product>(
    `SELECT p.id, p.slug, p.name, ${INFO_COLS}, p.info_updated_at
       FROM products p WHERE p.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getProductTrials(productId: number): Promise<ProductTrial[]> {
  const rows = await query<ProductTrial>(
    `SELECT t.nct_id, t.phase, t.sponsor, t.conditions AS indication, t.continents
       FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
      WHERE tp.product_id = $1`,
    [productId],
  );
  // Latest stage first, then newest registration.
  return rows.sort((a, b) => phaseRank(b.phase) - phaseRank(a.phase) || b.nct_id.localeCompare(a.nct_id));
}

export async function updateProductInfo(slug: string, info: ProductInfo): Promise<Product | null> {
  const rows = await query<{ slug: string }>(
    `UPDATE products SET
        modality = $2, phase = $3, moa = $4, roa = $5, approved = $6,
        approval_date = $7::date, sponsor = $8, drug_class = $9, info_updated_at = now()
      WHERE slug = $1
      RETURNING slug`,
    [
      slug, info.modality, info.phase, info.moa, info.roa, info.approved,
      info.approval_date, info.sponsor, info.drug_class,
    ],
  );
  return rows.length ? getProduct(slug) : null;
}

export async function dashboardCounts(): Promise<{ trials: number; products: number; productsWithInfo: number }> {
  const r = await query<{ trials: number; products: number; with_info: number }>(
    `SELECT (SELECT count(*)::int FROM trials WHERE is_active) AS trials,
            (SELECT count(DISTINCT tp.product_id)::int FROM trial_products tp) AS products,
            (SELECT count(*)::int FROM products p
              WHERE EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
                AND (p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
                     OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL
                     OR p.drug_class IS NOT NULL)) AS with_info`,
  );
  return { trials: r[0].trials, products: r[0].products, productsWithInfo: r[0].with_info };
}

/** All product names (for the merge picker). */
export async function productNames(): Promise<{ slug: string; name: string }[]> {
  return query<{ slug: string; name: string }>(
    `SELECT p.slug, p.name FROM products p
      WHERE EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
      ORDER BY p.name`,
  );
}

/**
 * Merge one product into another (e.g. a typo or code name into its INN).
 * Moves its trial links, fills any blank info fields of the target from it,
 * records a product_aliases row so future syncs/rebuilds keep it merged, and
 * deletes the merged product.
 */
export async function mergeProduct(fromSlug: string, intoSlug: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT * FROM products WHERE slug = ANY($1) FOR UPDATE",
      [[fromSlug, intoSlug]],
    );
    const from = r.rows.find((x) => x.slug === fromSlug);
    const into = r.rows.find((x) => x.slug === intoSlug);
    if (!from || !into) throw new Error("drug not found");
    if (from.id === into.id) throw new Error("cannot merge a drug into itself");

    await client.query(
      `INSERT INTO product_aliases (alias_slug, product_slug, product_name) VALUES ($1, $2, $3)
       ON CONFLICT (alias_slug) DO UPDATE SET product_slug = EXCLUDED.product_slug, product_name = EXCLUDED.product_name`,
      [from.slug, into.slug, into.name],
    );
    // Earlier merges that pointed at the merged product now point at the target.
    await client.query(
      "UPDATE product_aliases SET product_slug = $2, product_name = $3 WHERE product_slug = $1",
      [from.slug, into.slug, into.name],
    );
    await client.query(
      `INSERT INTO trial_products (nct_id, product_id)
       SELECT nct_id, $2 FROM trial_products WHERE product_id = $1
       ON CONFLICT DO NOTHING`,
      [from.id, into.id],
    );
    await client.query(
      `UPDATE products t SET
          modality = coalesce(t.modality, f.modality), phase = coalesce(t.phase, f.phase),
          moa = coalesce(t.moa, f.moa), roa = coalesce(t.roa, f.roa),
          approved = coalesce(t.approved, f.approved), approval_date = coalesce(t.approval_date, f.approval_date),
          sponsor = coalesce(t.sponsor, f.sponsor), drug_class = coalesce(t.drug_class, f.drug_class)
         FROM products f WHERE t.id = $2 AND f.id = $1`,
      [from.id, into.id],
    );
    await client.query("DELETE FROM products WHERE id = $1", [from.id]); // cascades its old links
    await client.query("COMMIT");
    return into.slug;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------------- #
// Data quality (trial_quality / data_quality_summary)
// --------------------------------------------------------------------------- #
export interface QualityOverview {
  checked: number;
  avgScore: number | null;
  clean: number;          // score = 1
  minor: number;          // 0.9 – 0.999
  needsReview: number;    // 0.75 – 0.899
  poor: number;           // < 0.75
  withLineage: number;    // trials that have a source record
  totalTrials: number;
  issues: { code: string; severity: string; trials: number }[];
}

export async function qualityOverview(): Promise<QualityOverview> {
  const [stats, issues] = await Promise.all([
    query<any>(
      `SELECT count(q.trial_id)::int AS checked,
              round(avg(q.score), 3)::float AS avg_score,
              count(*) FILTER (WHERE q.score = 1)::int AS clean,
              count(*) FILTER (WHERE q.score >= 0.9 AND q.score < 1)::int AS minor,
              count(*) FILTER (WHERE q.score >= 0.75 AND q.score < 0.9)::int AS needs_review,
              count(*) FILTER (WHERE q.score < 0.75)::int AS poor,
              (SELECT count(*)::int FROM trials WHERE is_active) AS total_trials,
              (SELECT count(DISTINCT trial_id)::int FROM trial_sources) AS with_lineage
         FROM trials t JOIN trial_quality q ON q.trial_id = t.nct_id
        WHERE t.is_active`,
    ),
    query<{ code: string; severity: string; trials: number }>(
      `SELECT code, severity, trials FROM data_quality_summary
        ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, trials DESC`,
    ),
  ]);
  const s = stats[0] ?? {};
  return {
    checked: s.checked ?? 0,
    avgScore: s.avg_score ?? null,
    clean: s.clean ?? 0,
    minor: s.minor ?? 0,
    needsReview: s.needs_review ?? 0,
    poor: s.poor ?? 0,
    withLineage: s.with_lineage ?? 0,
    totalTrials: s.total_trials ?? 0,
    issues,
  };
}

export interface QualityTrial {
  nct_id: string;
  phase: string | null;
  sponsor: string | null;
  score: number;
  issues: { code: string; severity: string; message: string; detail?: string[] }[];
  checked_at: string;
}

/** Trials with at least one issue (optionally a specific issue code), worst first. */
export async function qualityTrials(
  code: string | undefined,
  page: number,
  pageSize = 50,
): Promise<{ items: QualityTrial[]; total: number }> {
  const params: unknown[] = [];
  let where = "t.is_active AND jsonb_array_length(q.issues) > 0";
  if (code) {
    params.push(JSON.stringify([{ code }]));
    where += ` AND q.issues @> $${params.length}::jsonb`;
  }
  const total = (await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM trial_quality q JOIN trials t ON t.nct_id = q.trial_id WHERE ${where}`,
    params,
  ))[0]?.c ?? 0;
  params.push(pageSize, (Math.max(1, page) - 1) * pageSize);
  const items = await query<QualityTrial>(
    `SELECT t.nct_id, t.phase, t.sponsor, q.score::float AS score, q.issues,
            to_char(q.checked_at, 'YYYY-MM-DD HH24:MI') AS checked_at
       FROM trial_quality q JOIN trials t ON t.nct_id = q.trial_id
      WHERE ${where}
      ORDER BY q.score ASC, t.nct_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total };
}
