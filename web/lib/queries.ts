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
  /** obesity class: "primary" (default), "all", or one class */
  scope?: string;
  page?: number;
  pageSize?: number;
}

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
      `SELECT t.nct_id, t.phase, t.sponsor, t.conditions AS indication, t.continents,
              t.obesity_class, t.obesity_reason, ${PRODUCTS_JSON} AS products
         FROM trials t ${where}
        ORDER BY t.nct_id DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    ),
  ]);
  return { items, total: countRows[0]?.count ?? 0 };
}

export async function filterOptions(): Promise<FilterOptions> {
  const [phases, countries, classes] = await Promise.all([
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
    classes,
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
            count(t.nct_id) FILTER (WHERE t.obesity_class = 'primary')::int AS trials,
            count(t.nct_id)::int AS all_trials,
            coalesce(array_agg(DISTINCT t.phase) FILTER (WHERE t.phase IS NOT NULL AND t.obesity_class = 'primary'), '{}') AS trial_phases,
            (p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
             OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL
             OR p.drug_class IS NOT NULL) AS has_info
       FROM products p
       JOIN trial_products tp ON tp.product_id = p.id
       JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
      GROUP BY p.id
      ORDER BY trials DESC, all_trials DESC, p.name`,
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
    `SELECT t.nct_id, t.phase, t.sponsor, t.conditions AS indication, t.continents,
            t.obesity_class, t.obesity_reason
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
