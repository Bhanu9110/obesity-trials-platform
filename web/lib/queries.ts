import { query, pool } from "./db";
import type { HomeStats, ProductLink,
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
  /** registry overall status, e.g. RECRUITING */
  status?: string[];
  /** obesity class: "primary" (default), "all", or one class */
  scope?: string;
  sort?: TrialSort;
  page?: number;
  pageSize?: number;
}

export const TRIAL_SORTS = {
  newest: { label: "Newest registered", sql: "t.nct_id DESC" },
  start_desc: { label: "Start date — latest", sql: "nullif(to_jsonb(t) ->> 'start_date', '') DESC NULLS LAST, t.nct_id DESC" },
  start_asc: { label: "Start date — earliest", sql: "nullif(to_jsonb(t) ->> 'start_date', '') ASC NULLS LAST, t.nct_id DESC" },
  enrollment: { label: "Largest enrollment", sql: "(to_jsonb(t) ->> 'enrollment')::int DESC NULLS LAST, t.nct_id DESC" },
  phase: { label: "Most advanced phase", sql: `CASE
      WHEN t.phase LIKE '%PHASE4%' THEN 6 WHEN t.phase = 'PHASE2, PHASE3' THEN 5 WHEN t.phase LIKE '%PHASE3%' THEN 5
      WHEN t.phase LIKE '%PHASE2%' THEN 4 WHEN t.phase LIKE '%PHASE1%' THEN 3 WHEN t.phase = 'EARLY_PHASE1' THEN 2 ELSE 0 END DESC, t.nct_id DESC` },
  sponsor: { label: "Sponsor A–Z", sql: "t.sponsor ASC NULLS LAST, t.nct_id DESC" },
} as const;
export type TrialSort = keyof typeof TRIAL_SORTS;
export const isTrialSort = (s: unknown): s is TrialSort => typeof s === "string" && s in TRIAL_SORTS;

const TITLE_SQL = `(SELECT r.payload #>> '{protocolSection,identificationModule,briefTitle}'
                      FROM raw_trials r WHERE r.source = 'CTGOV' AND r.source_id = t.nct_id)`;

// Products of a trial as [{slug, name}], alphabetical.
const PRODUCTS_JSON = `
  coalesce((SELECT json_agg(json_build_object('slug', p.slug, 'name', p.name) ORDER BY p.name)
              FROM trial_products tp JOIN products p ON p.id = tp.product_id
             WHERE tp.nct_id = t.nct_id), '[]'::json)`;

export const OBESITY_SCOPES = ["primary", "comorbidity", "weight_related", "unrelated", "all"];

/**
 * Trials that name no drug at all (only placebo, a study arm, diet, a sentence…)
 * are kept in the database but hidden everywhere on the website. A trial that
 * names only a drug class has an "Undisclosed <class>" drug, so it is shown.
 */
export const hasDrug = (alias = "t") =>
  `EXISTS (SELECT 1 FROM trial_products hd WHERE hd.nct_id = ${alias}.nct_id)`;

function buildWhere(f: TrialFilters, params: unknown[]): string {
  const clauses: string[] = ["t.is_active = true", hasDrug("t")];
  const scope = f.scope && OBESITY_SCOPES.includes(f.scope) ? f.scope : "primary";
  if (scope !== "all") {
    params.push(scope);
    clauses.push(`t.obesity_class = $${params.length}`);
  }
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
  if (f.status?.length) {
    params.push(f.status);
    clauses.push(`(to_jsonb(t) ->> 'overall_status') = ANY($${params.length})`);
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

  // Count and page are fetched in parallel (the database may be far away).
  const pageParams = [...params, pageSize, (page - 1) * pageSize];
  const [countRows, items] = await Promise.all([
    query<{ count: number }>(`SELECT count(*)::int AS count FROM trials t ${where}`, params),
    query<TrialListItem>(
      `SELECT t.nct_id, t.phase, t.sponsor, t.lead_sponsor_class, t.conditions AS indication, t.continents,
              t.obesity_class, t.obesity_reason, ${PRODUCTS_JSON} AS products, ${TITLE_SQL} AS title,
              to_jsonb(t) ->> 'overall_status' AS overall_status,
              to_jsonb(t) ->> 'start_date' AS start_date,
              (to_jsonb(t) ->> 'enrollment')::int AS enrollment
         FROM trials t ${where}
        ORDER BY ${TRIAL_SORTS[isTrialSort(f.sort) ? f.sort : "newest"].sql}
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    ),
  ]);
  return { items, total: countRows[0]?.count ?? 0 };
}

export async function filterOptions(): Promise<FilterOptions> {
  const [phases, countries, classes, stats, facetRows] = await Promise.all([
    query<{ phase: string }>(
      `SELECT DISTINCT phase FROM trials t WHERE t.is_active AND ${hasDrug("t")} AND coalesce(phase, '') <> ''`,
    ),
    query<{ country: string; continent: string }>(
      `SELECT c AS country, continent_of(c) AS continent
         FROM (SELECT DISTINCT unnest(countries) AS c FROM trials t WHERE t.is_active AND ${hasDrug("t")}) x
        ORDER BY c`,
    ),
    query<{ name: string; trials: number }>(
      `SELECT obesity_class AS name, count(*)::int AS trials FROM trials t WHERE t.is_active AND ${hasDrug("t")} GROUP BY 1`,
    ),
    homeStats().catch(() => undefined),
    query<{ kind: string; name: string; n: number }>(
      `SELECT 'phase' AS kind, coalesce(phase, '') AS name, count(*)::int AS n FROM trials t
        WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")} GROUP BY 2
       UNION ALL
       SELECT 'status', coalesce(to_jsonb(t) ->> 'overall_status', ''), count(*)::int FROM trials t
        WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")} GROUP BY 2
       UNION ALL
       SELECT 'sponsor', coalesce(lead_sponsor_class, ''), count(*)::int FROM trials t
        WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")} GROUP BY 2`,
    ).catch(() => []),
  ]);
  const facet = (kind: string) => Object.fromEntries(facetRows.filter((r) => r.kind === kind).map((r) => [r.name, r.n]));
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
    classes,
    stats,
    facets: { phases: facet("phase"), statuses: facet("status"), sponsorClasses: facet("sponsor") },
  };
}

/** Headline numbers for the home page (primary-obesity trials with a drug). */
export async function homeStats(): Promise<HomeStats> {
  const r = await query<Omit<HomeStats, "lastSync"> & { last_sync: Date | null }>(
    `WITH t AS (SELECT * FROM trials t WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")})
     SELECT (SELECT count(*)::int FROM t) AS trials,
            (SELECT count(DISTINCT tp.product_id)::int FROM trial_products tp JOIN t ON t.nct_id = tp.nct_id) AS drugs,
            (SELECT count(*)::int FROM t WHERE lead_sponsor_class = 'INDUSTRY') AS industry,
            (SELECT count(*)::int FROM t WHERE phase IN ('PHASE3', 'PHASE4', 'PHASE2, PHASE3')) AS late,
            (SELECT count(*)::int FROM t WHERE overall_status IN ('RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION')) AS recruiting,
            (SELECT count(DISTINCT c)::int FROM t, unnest(t.countries) c) AS countries,
            (SELECT max(run_at) FROM sync_runs WHERE status IN ('success', 'partial')) AS last_sync`,
  );
  const x = r[0];
  return {
    trials: x.trials, drugs: x.drugs, industry: x.industry, late: x.late, recruiting: x.recruiting,
    countries: x.countries, lastSync: x.last_sync ? new Date(x.last_sync).toISOString() : null,
  };
}

// --------------------------------------------------------------------------- #
// Products (drug pages)
// --------------------------------------------------------------------------- #
// Manually curated product info (all blank until edited on the drug page).
const INFO_COLS = `p.modality, p.phase, p.moa, p.roa, p.approved,
  to_char(p.approval_date, 'YYYY-MM-DD') AS approval_date, p.sponsor, p.drug_class,
  p.aliases, p.brand_names, p.candidate, p.parent_drug, p.therapy_subclass, p.indication`;

const HAS_INFO = `(p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
   OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL OR p.drug_class IS NOT NULL
   OR p.aliases IS NOT NULL OR p.brand_names IS NOT NULL OR p.candidate IS NOT NULL OR p.parent_drug IS NOT NULL
   OR p.therapy_subclass IS NOT NULL OR p.indication IS NOT NULL)`;

export async function listProducts(): Promise<ProductSummary[]> {
  return query<ProductSummary>(
    `SELECT p.slug, p.name, ${INFO_COLS},
            count(t.nct_id) FILTER (WHERE t.obesity_class = 'primary')::int AS trials,
            count(t.nct_id)::int AS all_trials,
            coalesce(array_agg(DISTINCT t.phase) FILTER (WHERE t.phase IS NOT NULL AND t.obesity_class = 'primary'), '{}') AS trial_phases,
            ${HAS_INFO} AS has_info
       FROM products p
       JOIN trial_products tp ON tp.product_id = p.id
       JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
      GROUP BY p.id
      ORDER BY trials DESC, all_trials DESC, p.name`,
  );
}

export async function getProduct(slug: string): Promise<Product | null> {
  const rows = await query<Product>(
    // summary via to_jsonb: the page keeps working in the minute before migration 0016 runs.
    `SELECT p.id, p.slug, p.name, ${INFO_COLS}, p.info_updated_at,
            to_jsonb(p) ->> 'summary' AS summary, to_jsonb(p) ->> 'summary_updated_at' AS summary_updated_at,
            (SELECT count(*) FILTER (WHERE t.obesity_class = 'primary')::int
               FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
              WHERE tp.product_id = p.id) AS trials,
            (SELECT count(*)::int
               FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
              WHERE tp.product_id = p.id) AS all_trials
       FROM products p WHERE p.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getProductTrials(productId: number): Promise<ProductTrial[]> {
  const rows = await query<ProductTrial>(
    // Status / start date / enrollment are read via to_jsonb so the page keeps
    // working in the minute between a deploy and migration 0010.
    `SELECT t.nct_id, t.phase, t.sponsor, t.lead_sponsor_class, t.conditions AS indication, t.continents,
            t.obesity_class, t.obesity_reason,
            r.payload #>> '{protocolSection,identificationModule,briefTitle}' AS title,
            to_jsonb(t) ->> 'overall_status' AS overall_status,
            to_jsonb(t) ->> 'start_date' AS start_date,
            (to_jsonb(t) ->> 'enrollment')::int AS enrollment
       FROM trial_products tp
       JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
       LEFT JOIN raw_trials r ON r.source = 'CTGOV' AND r.source_id = t.nct_id
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
        approval_date = $7::date, sponsor = $8, drug_class = $9,
        aliases = $10, brand_names = $11, candidate = $12, parent_drug = $13,
        therapy_subclass = $14, indication = $15, info_updated_at = now()
      WHERE slug = $1
      RETURNING slug`,
    [
      slug, info.modality, info.phase, info.moa, info.roa, info.approved,
      info.approval_date, info.sponsor, info.drug_class,
      info.aliases, info.brand_names, info.candidate, info.parent_drug, info.therapy_subclass, info.indication,
    ],
  );
  return rows.length ? getProduct(slug) : null;
}

/** Save the hand-written product summary (blank = remove). */
export async function updateProductSummary(slug: string, summary: string | null): Promise<Product | null> {
  const rows = await query<{ slug: string }>(
    `UPDATE products SET summary = $2, summary_updated_at = now() WHERE slug = $1 RETURNING slug`,
    [slug, summary],
  );
  return rows.length ? getProduct(slug) : null;
}

export async function dashboardCounts(): Promise<{
  trials: number; storedTrials: number; noDrug: number; products: number; productsWithInfo: number;
}> {
  const r = await query<{ trials: number; stored: number; no_drug: number; products: number; with_info: number }>(
    `SELECT (SELECT count(*)::int FROM trials t WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")}) AS trials,
            (SELECT count(*)::int FROM trials t WHERE t.is_active AND ${hasDrug("t")}) AS stored,
            (SELECT count(*)::int FROM trials t WHERE t.is_active AND NOT ${hasDrug("t")}) AS no_drug,
            (SELECT count(DISTINCT tp.product_id)::int FROM trial_products tp
               JOIN trials t ON t.nct_id = tp.nct_id AND t.obesity_class = 'primary') AS products,
            (SELECT count(*)::int FROM products p
              WHERE EXISTS (SELECT 1 FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id
                             WHERE tp.product_id = p.id AND t.obesity_class = 'primary')
                AND (p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
                     OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL
                     OR p.drug_class IS NOT NULL)) AS with_info`,
  );
  return {
    trials: r[0].trials, storedTrials: r[0].stored, noDrug: r[0].no_drug,
    products: r[0].products, productsWithInfo: r[0].with_info,
  };
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
          sponsor = coalesce(t.sponsor, f.sponsor), drug_class = coalesce(t.drug_class, f.drug_class),
          aliases = coalesce(t.aliases, f.aliases), brand_names = coalesce(t.brand_names, f.brand_names),
          summary = coalesce(t.summary, f.summary),
          candidate = coalesce(t.candidate, f.candidate), parent_drug = coalesce(t.parent_drug, f.parent_drug),
          therapy_subclass = coalesce(t.therapy_subclass, f.therapy_subclass), indication = coalesce(t.indication, f.indication)
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
              (SELECT count(*)::int FROM trials t3 WHERE t3.is_active AND t3.obesity_class = 'primary' AND ${hasDrug("t3")}) AS total_trials,
              (SELECT count(DISTINCT s.trial_id)::int FROM trial_sources s
                 JOIN trials t2 ON t2.nct_id = s.trial_id AND t2.obesity_class = 'primary' AND ${hasDrug("t2")}) AS with_lineage
         FROM trials t JOIN trial_quality q ON q.trial_id = t.nct_id
        WHERE t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")}`,
    ),
    // Issue counts over the trials shown on the website (primary obesity).
    query<{ code: string; severity: string; trials: number }>(
      `SELECT i->>'code' AS code, i->>'severity' AS severity, count(*)::int AS trials
         FROM trial_quality q
         JOIN trials t ON t.nct_id = q.trial_id AND t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")}
        CROSS JOIN LATERAL jsonb_array_elements(q.issues) AS i
        GROUP BY 1, 2
        ORDER BY CASE i->>'severity' WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, count(*) DESC`,
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

/** Score bands shown as tiles on the Data quality page. */
export const QUALITY_BANDS = {
  clean: { label: "Clean (1.00)", sql: "q.score >= 1" },
  minor: { label: "Minor (0.90–0.99)", sql: "q.score >= 0.9 AND q.score < 1" },
  review: { label: "Review (0.75–0.89)", sql: "q.score >= 0.75 AND q.score < 0.9" },
  poor: { label: "Poor (< 0.75)", sql: "q.score < 0.75" },
} as const;
export type QualityBand = keyof typeof QUALITY_BANDS;
export const isQualityBand = (v: unknown): v is QualityBand =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(QUALITY_BANDS, v);

export interface QualityFilter {
  code?: string;          // one issue code
  band?: QualityBand;     // score band; none = every trial with at least one issue
  q?: string;             // NCT ID / sponsor / indication / drug text
}

function qualityWhere(f: QualityFilter, params: unknown[]): string {
  let where = `t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")}`;
  if (f.band) where += ` AND ${QUALITY_BANDS[f.band].sql}`;
  else where += " AND jsonb_array_length(q.issues) > 0";
  if (f.code) {
    params.push(JSON.stringify([{ code: f.code }]));
    where += ` AND q.issues @> $${params.length}::jsonb`;
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    const i = params.length;
    where += ` AND (t.nct_id ILIKE $${i} OR coalesce(t.sponsor, '') ILIKE $${i}
                OR array_to_string(t.conditions, ' ') ILIKE $${i}
                OR array_to_string(t.interventions, ' ') ILIKE $${i})`;
  }
  return where;
}

export interface QualityTrialRow extends QualityTrial {
  indication: string[];
  interventions: string[];
  continents: string[];
}

/** Trials for the current filter (worst first), with what is needed to cross-check them. */
export async function qualityTrials(
  f: QualityFilter,
  page: number,
  pageSize = 50,
): Promise<{ items: QualityTrialRow[]; total: number }> {
  const params: unknown[] = [];
  const where = qualityWhere(f, params);
  const limit = pageSize > 0 ? pageSize : 100000;
  const pageParams = [...params, limit, (Math.max(1, page) - 1) * (pageSize > 0 ? pageSize : 0)];
  const [countRows, items] = await Promise.all([
    query<{ c: number }>(
      `SELECT count(*)::int AS c FROM trial_quality q JOIN trials t ON t.nct_id = q.trial_id WHERE ${where}`,
      params,
    ),
    query<QualityTrialRow>(
      `SELECT t.nct_id, t.phase, t.sponsor, q.score::float AS score, q.issues,
              t.conditions AS indication, t.interventions, t.continents,
              to_char(q.checked_at, 'YYYY-MM-DD HH24:MI') AS checked_at
         FROM trial_quality q JOIN trials t ON t.nct_id = q.trial_id
        WHERE ${where}
        ORDER BY q.score ASC, t.nct_id DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    ),
  ]);
  return { items, total: countRows[0]?.c ?? 0 };
}

/** Issue counts for the issue chips, within the selected score band (or all trials). */
export async function qualityIssueCounts(band?: QualityBand): Promise<{ code: string; severity: string; trials: number }[]> {
  return query<{ code: string; severity: string; trials: number }>(
    `SELECT i->>'code' AS code, i->>'severity' AS severity, count(*)::int AS trials
       FROM trial_quality q
       JOIN trials t ON t.nct_id = q.trial_id AND t.is_active AND t.obesity_class = 'primary' AND ${hasDrug("t")}
      CROSS JOIN LATERAL jsonb_array_elements(q.issues) AS i
      ${band ? `WHERE ${QUALITY_BANDS[band].sql}` : ""}
      GROUP BY 1, 2
      ORDER BY CASE i->>'severity' WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, count(*) DESC`,
  );
}

// --------------------------------------------------------------------------- #
// Change history (trial_changes)
// --------------------------------------------------------------------------- #
export interface ChangeItem {
  id: number;
  trial_id: string;
  changed_at: string;
  change: "added" | "updated" | "removed" | "reclassified";
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  sponsor: string | null;
  obesity_class: string | null;
}

export const CHANGE_KINDS = ["added", "updated", "reclassified", "removed"] as const;

/** Time zone for dates shown on the website (APP_TIMEZONE, default India). */
export function displayTimeZone(): string {
  const tz = process.env.APP_TIMEZONE || "Asia/Kolkata";
  return /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz) ? tz : "UTC";
}

export async function recentChanges(opts: {
  kind?: string;
  days?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ChangeItem[]; total: number; counts: Record<string, number> }> {
  const days = Math.min(Math.max(1, opts.days ?? 30), 3650);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const params: unknown[] = [days];
  let where = "c.changed_at >= now() - make_interval(days => $1)";
  if (opts.q) {
    params.push(`%${opts.q.trim()}%`);
    where += ` AND (c.trial_id ILIKE $${params.length} OR coalesce(t.sponsor, '') ILIKE $${params.length})`;
  }
  const countParams = [...params];
  const countWhere = where;
  if (opts.kind && (CHANGE_KINDS as readonly string[]).includes(opts.kind)) {
    params.push(opts.kind);
    where += ` AND c.change = $${params.length}`;
  }
  const pageParams = [...params, pageSize, (page - 1) * pageSize];
  const [items, totals, counts] = await Promise.all([
    query<ChangeItem>(
      `SELECT c.id, c.trial_id, to_char(c.changed_at AT TIME ZONE $${pageParams.length + 1}, 'YYYY-MM-DD HH24:MI') AS changed_at,
              c.change, c.field,
              c.old_value, c.new_value, t.sponsor, t.obesity_class
         FROM trial_changes c LEFT JOIN trials t ON t.nct_id = c.trial_id
        WHERE ${where}
        ORDER BY c.changed_at DESC, c.id DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      [...pageParams, displayTimeZone()],
    ),
    query<{ c: number }>(
      `SELECT count(*)::int AS c FROM trial_changes c LEFT JOIN trials t ON t.nct_id = c.trial_id WHERE ${where}`,
      params,
    ),
    query<{ change: string; c: number }>(
      `SELECT c.change, count(*)::int AS c FROM trial_changes c LEFT JOIN trials t ON t.nct_id = c.trial_id
        WHERE ${countWhere} GROUP BY 1`,
      countParams,
    ),
  ]);
  return {
    items,
    total: totals[0]?.c ?? 0,
    counts: Object.fromEntries(counts.map((r) => [r.change, r.c])),
  };
}

// --------------------------------------------------------------------------- #
// Admin: pipeline runs, retry / dead-letter queue
// --------------------------------------------------------------------------- #
export interface SyncRunRow {
  id: string;
  run_at: string;
  status: string;
  mode: string | null;
  trials_fetched: number | null;
  trials_upserted: number | null;
  trials_unchanged: number | null;
  trials_filtered: number | null;
  trials_failed: number | null;
  duration_ms: number | null;
  error_detail: unknown;
}

export interface FailureRow {
  nct_id: string;
  status: "pending" | "dead";
  failure_type: string;
  error_msg: string;
  attempts: number;
  first_failed_at: string | null;
  last_attempted: string | null;
  next_attempt_at: string | null;
}

export async function recentRuns(limit = 15): Promise<SyncRunRow[]> {
  return query<SyncRunRow>(
    `SELECT id, run_at, status, mode, trials_fetched, trials_upserted, trials_unchanged, trials_filtered,
            trials_failed, duration_ms, error_detail
       FROM sync_runs ORDER BY run_at DESC LIMIT $1`,
    [limit],
  );
}

export async function openFailures(): Promise<FailureRow[]> {
  return query<FailureRow>(
    `SELECT nct_id, status, failure_type, error_msg, retry_count + 1 AS attempts,
            first_failed_at, last_attempted, next_attempt_at
       FROM sync_failures WHERE status IN ('pending', 'dead')
      ORDER BY CASE status WHEN 'dead' THEN 0 ELSE 1 END, last_attempted DESC
      LIMIT 200`,
  );
}

/** Re-queue (dead -> pending, due now) or dismiss an open failure. */
export async function updateFailure(nctId: string, action: "requeue" | "dismiss"): Promise<boolean> {
  const rows = action === "requeue"
    ? await query(
        `UPDATE sync_failures SET status = 'pending', retry_count = 0, next_attempt_at = now()
          WHERE nct_id = $1 AND status IN ('pending', 'dead') RETURNING nct_id`,
        [nctId],
      )
    : await query(
        `UPDATE sync_failures SET status = 'dismissed', resolved_at = now(), resolution = 'dismissed on the Admin page'
          WHERE nct_id = $1 AND status IN ('pending', 'dead') RETURNING nct_id`,
        [nctId],
      );
  return rows.length > 0;
}

// --------------------------------------------------------------------------- #
// Trial page: what this database holds about one trial
// --------------------------------------------------------------------------- #
export interface StoredTrial {
  nct_id: string;
  phase: string | null;
  sponsor: string | null;
  lead_sponsor_class: string | null;
  conditions: string[];
  interventions: string[];
  countries: string[];
  continents: string[];
  obesity_class: string;
  obesity_reason: string | null;
  title: string | null;
  source_updated_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  products: { slug: string; name: string }[];
  quality: { score: number; issues: { code: string; severity: string; message: string; detail?: string[] }[] } | null;
}

export interface TrialRecord {
  stored: StoredTrial | null;
  changes: ChangeItem[];
}

/** Stored fields, drugs, quality and change history of one trial (stored or removed). */
export async function trialRecord(nctId: string): Promise<TrialRecord> {
  const tz = displayTimeZone();
  const [rows, changes] = await Promise.all([
    query<StoredTrial>(
      `SELECT t.nct_id, t.phase, t.sponsor, t.lead_sponsor_class, t.conditions, t.interventions, t.countries,
              t.continents, t.obesity_class, t.obesity_reason,
              r.payload #>> '{protocolSection,identificationModule,briefTitle}' AS title,
              to_char(t.source_updated_at, 'YYYY-MM-DD') AS source_updated_at,
              to_char(t.first_seen_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS first_seen_at,
              to_char(t.last_seen_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS last_seen_at,
              ${PRODUCTS_JSON} AS products,
              (SELECT json_build_object('score', q.score::float, 'issues', q.issues)
                 FROM trial_quality q WHERE q.trial_id = t.nct_id) AS quality
         FROM trials t
         LEFT JOIN raw_trials r ON r.source = 'CTGOV' AND r.source_id = t.nct_id
        WHERE t.nct_id = $1`,
      [nctId, tz],
    ),
    query<ChangeItem>(
      `SELECT c.id, c.trial_id, to_char(c.changed_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS changed_at,
              c.change, c.field, c.old_value, c.new_value, NULL::text AS sponsor, NULL::text AS obesity_class
         FROM trial_changes c
        WHERE c.trial_id = $1
        ORDER BY c.changed_at DESC, c.id DESC
        LIMIT 100`,
      [nctId, tz],
    ),
  ]);
  return { stored: rows[0] ?? null, changes };
}


// --------------------------------------------------------------------------- #
// Overview dashboard, trial preview and global search
// --------------------------------------------------------------------------- #
const SHOWN = (a = "t") => `${a}.is_active AND ${a}.obesity_class = 'primary' AND ${hasDrug(a)}`;

export interface Overview {
  phases: { name: string; count: number }[];
  statuses: { name: string; count: number }[];
  startYears: { year: number; count: number }[];
  sponsors: { name: string; count: number; industry: boolean }[];
  regions: { name: string; count: number }[];
  drugs: { slug: string; name: string; trials: number; phases: string[] }[];
  latest: { nct_id: string; title: string | null; phase: string | null; sponsor: string | null; first_seen: string; products: ProductLink[] }[];
  changes7d: number;
}

export async function overview(): Promise<Overview> {
  const tz = displayTimeZone();
  const [phases, statuses, years, sponsors, regions, drugs, latest, changes] = await Promise.all([
    query<{ name: string; count: number }>(
      `SELECT coalesce(nullif(phase, ''), 'NONE') AS name, count(*)::int AS count FROM trials t WHERE ${SHOWN()} GROUP BY 1`,
    ),
    query<{ name: string; count: number }>(
      `SELECT coalesce(to_jsonb(t) ->> 'overall_status', 'UNKNOWN') AS name, count(*)::int AS count FROM trials t WHERE ${SHOWN()} GROUP BY 1`,
    ),
    query<{ year: number; count: number }>(
      `SELECT left(to_jsonb(t) ->> 'start_date', 4)::int AS year, count(*)::int AS count
         FROM trials t WHERE ${SHOWN()} AND (to_jsonb(t) ->> 'start_date') ~ '^[0-9]{4}'
        GROUP BY 1 ORDER BY 1`,
    ),
    query<{ name: string; count: number; industry: boolean }>(
      `SELECT sponsor AS name, count(*)::int AS count, bool_or(lead_sponsor_class = 'INDUSTRY') AS industry
         FROM trials t WHERE ${SHOWN()} AND sponsor IS NOT NULL
        GROUP BY sponsor ORDER BY count DESC, sponsor LIMIT 8`,
    ),
    query<{ name: string; count: number }>(
      `SELECT c AS name, count(*)::int AS count FROM trials t, unnest(t.continents) c WHERE ${SHOWN()} GROUP BY c ORDER BY count DESC`,
    ),
    query<{ slug: string; name: string; trials: number; phases: string[] }>(
      `SELECT p.slug, p.name, count(*)::int AS trials,
              coalesce(array_agg(DISTINCT t.phase) FILTER (WHERE t.phase IS NOT NULL), '{}') AS phases
         FROM products p JOIN trial_products tp ON tp.product_id = p.id
         JOIN trials t ON t.nct_id = tp.nct_id AND ${SHOWN()}
        WHERE p.name NOT ILIKE 'undisclosed%' AND p.name NOT ILIKE 'placebo%'
        GROUP BY p.id ORDER BY trials DESC, p.name LIMIT 8`,
    ),
    query<Overview["latest"][number]>(
      `SELECT t.nct_id, ${TITLE_SQL} AS title, t.phase, t.sponsor,
              to_char(t.first_seen_at AT TIME ZONE $1, 'YYYY-MM-DD') AS first_seen, ${PRODUCTS_JSON} AS products
         FROM trials t WHERE ${SHOWN()}
        ORDER BY t.first_seen_at DESC, t.nct_id DESC LIMIT 6`,
      [tz],
    ),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM trial_changes WHERE changed_at > now() - interval '7 days'`).catch(() => [{ n: 0 }]),
  ]);
  const thisYear = new Date().getFullYear();
  return {
    phases, statuses,
    startYears: years.filter((y) => y.year >= thisYear - 14 && y.year <= thisYear + 1),
    sponsors, regions, drugs, latest, changes7d: changes[0]?.n ?? 0,
  };
}

export interface TrialPreview {
  nct_id: string;
  title: string | null;
  official_title: string | null;
  summary: string | null;
  phase: string | null;
  sponsor: string | null;
  lead_sponsor_class: string | null;
  overall_status: string | null;
  start_date: string | null;
  primary_completion: string | null;
  completion: string | null;
  enrollment: number | null;
  conditions: string[];
  countries: string[];
  continents: string[];
  products: ProductLink[];
  first_seen: string | null;
}

/** Everything the quick-preview panel shows, from the stored record. */
export async function trialPreview(nctId: string): Promise<TrialPreview | null> {
  const rows = await query<TrialPreview>(
    `SELECT t.nct_id, t.phase, t.sponsor, t.lead_sponsor_class, t.conditions, t.countries, t.continents,
            ${PRODUCTS_JSON} AS products,
            r.payload #>> '{protocolSection,identificationModule,briefTitle}' AS title,
            r.payload #>> '{protocolSection,identificationModule,officialTitle}' AS official_title,
            left(r.payload #>> '{protocolSection,descriptionModule,briefSummary}', 900) AS summary,
            coalesce(to_jsonb(t) ->> 'overall_status', r.payload #>> '{protocolSection,statusModule,overallStatus}') AS overall_status,
            coalesce(to_jsonb(t) ->> 'start_date', r.payload #>> '{protocolSection,statusModule,startDateStruct,date}') AS start_date,
            r.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}' AS primary_completion,
            r.payload #>> '{protocolSection,statusModule,completionDateStruct,date}' AS completion,
            coalesce((to_jsonb(t) ->> 'enrollment')::int, (r.payload #>> '{protocolSection,designModule,enrollmentInfo,count}')::int) AS enrollment,
            to_char(t.first_seen_at, 'YYYY-MM-DD') AS first_seen
       FROM trials t
       LEFT JOIN raw_trials r ON r.source = 'CTGOV' AND r.source_id = t.nct_id
      WHERE t.nct_id = $1`,
    [nctId],
  );
  return rows[0] ?? null;
}

export interface SearchResults {
  trials: { nct_id: string; title: string | null; phase: string | null; sponsor: string | null }[];
  drugs: { slug: string; name: string; trials: number }[];
  sponsors: { name: string; trials: number }[];
}

/** Global search (the Ctrl/⌘ K palette). */
export async function globalSearch(q: string, opts: { trials: boolean; drugs: boolean }): Promise<SearchResults> {
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const [trials, drugs, sponsors] = await Promise.all([
    opts.trials
      ? query<SearchResults["trials"][number]>(
          `SELECT t.nct_id, ${TITLE_SQL} AS title, t.phase, t.sponsor FROM trials t
            WHERE ${SHOWN()} AND (t.nct_id ILIKE $1 OR ${TITLE_SQL} ILIKE $1
                  OR array_to_string(t.conditions, ' ') ILIKE $1)
            ORDER BY (t.nct_id ILIKE $1) DESC, t.nct_id DESC LIMIT 6`,
          [like],
        )
      : Promise.resolve([]),
    opts.drugs
      ? query<SearchResults["drugs"][number]>(
          `SELECT p.slug, p.name, count(t.nct_id)::int AS trials
             FROM products p JOIN trial_products tp ON tp.product_id = p.id
             JOIN trials t ON t.nct_id = tp.nct_id AND ${SHOWN()}
            WHERE p.name ILIKE $1 OR coalesce(p.aliases, '') ILIKE $1 OR coalesce(p.brand_names, '') ILIKE $1
            GROUP BY p.id ORDER BY (p.name ILIKE $2) DESC, trials DESC LIMIT 6`,
          [like, `${q}%`],
        )
      : Promise.resolve([]),
    opts.trials
      ? query<SearchResults["sponsors"][number]>(
          `SELECT t.sponsor AS name, count(*)::int AS trials FROM trials t
            WHERE ${SHOWN()} AND t.sponsor ILIKE $1 GROUP BY t.sponsor ORDER BY trials DESC LIMIT 5`,
          [like],
        )
      : Promise.resolve([]),
  ]);
  return { trials, drugs, sponsors };
}
