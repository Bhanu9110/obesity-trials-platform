import { query, pool } from "./db";
import type { HomeStats, ProductLink,
  FilterOptions,
  Product,
  ProductInfo,
  ProductMilestone,
  ProductResult,
  UpcomingMilestone,
  ProductSummary,
  ProductTrial,
  TrialListItem,
} from "./types";
import { CONTINENT_ORDER, phaseRank } from "./format";
import { cleanNames, splitNames } from "./aliases";

/** Letters and digits only, lower case — "NN-9440" and "nn 9440" both become "nn9440". */
const squashTerm = (q: string) => q.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

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
      -- a drug's code / alias / brand name ("NN9440", "LY-3437943"): that drug's trials
      OR ($${i + 1} <> '' AND EXISTS (SELECT 1 FROM trial_products tp WHERE tp.nct_id = t.nct_id AND tp.product_id IN (
            SELECT p.id FROM products p
             WHERE regexp_replace(lower(coalesce(${OTHER_NAMES("p")}, '')), '[^a-z0-9]', '', 'g') LIKE '%' || $${i + 1} || '%')))
    )`);
    params.push(squashTerm(f.q).length >= 3 ? squashTerm(f.q) : "");
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
            (SELECT count(DISTINCT tp.product_id)::int FROM trial_products tp JOIN t ON t.nct_id = tp.nct_id
               JOIN products p ON p.id = tp.product_id AND p.kind IS NULL) AS drugs,
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
// Drug profile: the hand-entered value, or while that is blank the researched one
// (products.curated_info, from sync/data/profiles) or else the automatic one (products.auto_info,
// filled daily by `npm run enrich-products`). Both are read through to_jsonb so pages keep
// working in the minute before migrations 0017 / 0024 run.
const objOrEmpty = (col: string) => `CASE WHEN jsonb_typeof(to_jsonb(p) -> '${col}') = 'object' THEN to_jsonb(p) -> '${col}' ELSE '{}'::jsonb END`;
const AUTO_JOIN = `CROSS JOIN LATERAL (SELECT ${objOrEmpty("auto_info")} || ${objOrEmpty("curated_info")} AS ai) x`;
const autoVal = (f: string) => `(x.ai -> '${f}' ->> 'value')`;
/** Development & regulatory fields (0024), read through to_jsonb (see above). */
export const DEV_FIELDS = ["inn", "api", "regulatory_status", "designations", "patents", "anticipated_launch", "efficacy_signal", "safety_signal"] as const;
const INFO_COLS = [
  "modality", "phase", "moa", "roa", "approved", "approval_date", "sponsor", "drug_class",
  "aliases", "brand_names", "candidate", "parent_drug", "therapy_subclass", "indication",
].map((f) => f === "approval_date"
  ? `coalesce(to_char(p.approval_date, 'YYYY-MM-DD'), ${autoVal(f)}) AS approval_date`
  : `coalesce(p.${f}, ${autoVal(f)}) AS ${f}`)
  .concat(DEV_FIELDS.map((f) => `coalesce(to_jsonb(p) ->> '${f}', ${autoVal(f)}) AS ${f}`))
  .join(",\n  ");
// Which shown values are automatic: {field: {value, source}} for every blank hand-entered field.
const AUTO_SHOWN = `(SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
     FROM jsonb_each(CASE WHEN jsonb_typeof(x.ai) = 'object' THEN x.ai ELSE '{}'::jsonb END) e
    WHERE to_jsonb(p) ->> e.key IS NULL)`;

const HAS_INFO = `(p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
   OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL OR p.drug_class IS NOT NULL
   OR p.aliases IS NOT NULL OR p.brand_names IS NOT NULL OR p.candidate IS NOT NULL OR p.parent_drug IS NOT NULL
   OR p.therapy_subclass IS NOT NULL OR p.indication IS NOT NULL
   ${DEV_FIELDS.map((f) => `OR to_jsonb(p) ->> '${f}' IS NOT NULL`).join(" ")})`;

/**
 * Clinical trials a drug's conference abstracts report (e.g. ADA 2026): distinct trial IDs / names,
 * abstracts that name no trial counting as one. Used only while the drug has no ClinicalTrials.gov
 * trial in the database (a trial presented at a meeting before it has an NCT record here).
 */
const CONF_TRIALS = `(SELECT count(DISTINCT coalesce(upper(tr.id), '#unnamed'))::int
     FROM product_abstracts pa JOIN conference_abstracts ca USING (source, abstract_no)
     LEFT JOIN LATERAL unnest(nullif(ca.trial_ids, '{}')) AS tr(id) ON true
    WHERE pa.product_slug = p.slug
      AND (ca.stage ILIKE 'clinical%'
           -- a company's own report of a clinical-stage drug (e.g. "Phase 1") counts as its trial
           OR (to_jsonb(ca) ->> 'kind' = 'company_report' AND ca.stage ~* 'phase'))) `;

/**
 * Every name a drug page is known by besides its own name, for search: hand-entered and automatic
 * aliases and brand names, spellings merged into it (product_aliases), code names from company
 * pipeline pages, names used in conference abstracts / company reports, and the "other names"
 * ClinicalTrials.gov lists for its interventions. Comma-separated.
 */
export const OTHER_NAMES = (p = "p") => `(SELECT string_agg(DISTINCT n, ', ') FROM (
       SELECT trim(unnest(regexp_split_to_array(concat_ws(',', ${p}.aliases, to_jsonb(${p}) #>> '{auto_info,aliases,value}',
                ${p}.brand_names, to_jsonb(${p}) #>> '{auto_info,brand_names,value}', to_jsonb(${p}) #>> '{curated_info,brand_names,value}',
                to_jsonb(${p}) ->> 'inn', to_jsonb(${p}) #>> '{auto_info,inn,value}'), '\\s*[,;]\\s*'))) AS n
       UNION SELECT CASE WHEN pa.alias_slug ~ '[0-9]' THEN upper(pa.alias_slug) ELSE pa.alias_slug END
         FROM product_aliases pa WHERE pa.product_slug = ${p}.slug
       UNION SELECT pc.alias FROM pipeline_code_names pc WHERE pc.product_slug = ${p}.slug
       UNION SELECT ab.drug_name FROM product_abstracts ab WHERE ab.product_slug = ${p}.slug
       UNION SELECT unnest(ab.aliases) FROM product_abstracts ab WHERE ab.product_slug = ${p}.slug
       UNION SELECT io.other_name FROM trial_products tp JOIN intervention_other_names io ON io.nct_id = tp.nct_id
         WHERE tp.product_id = ${p}.id AND regexp_replace(lower(io.intervention), '[^a-z0-9]', '', 'g') = ${p}.slug
     ) s WHERE n <> '' AND lower(n) <> lower(${p}.name))`;

export async function listProducts(): Promise<ProductSummary[]> {
  const [rows, next] = await Promise.all([listProductRows(), nextMilestones()]);
  for (const r of rows) {
    r.other_names = cleanNames(splitNames(r.other_names), r.name).join(", ") || null; // no glued-together junk
    const m = next.get(r.slug);
    r.next_milestone = m ? { title: m.title, date_label: m.date_label, kind: m.kind } : null;
  }
  return rows;
}

async function listProductRows(): Promise<ProductSummary[]> {
  return query<ProductSummary>(
    `SELECT p.slug, p.name, ${INFO_COLS},
            -- no ClinicalTrials.gov trial yet: the clinical trials its conference abstracts report
            CASE WHEN count(t.nct_id) = 0 THEN ${CONF_TRIALS}
                 ELSE count(t.nct_id) FILTER (WHERE t.obesity_class = 'primary')::int END AS trials,
            CASE WHEN count(t.nct_id) = 0 THEN ${CONF_TRIALS} ELSE count(t.nct_id)::int END AS all_trials,
            count(t.nct_id)::int AS nct_trials,
            CASE WHEN count(t.nct_id) = 0 THEN ${CONF_TRIALS} ELSE 0 END AS conference_trials,
            -- for "no active development": trials still running, and the newest start year
            count(t.nct_id) FILTER (WHERE to_jsonb(t) ->> 'overall_status' IN
              ('RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION', 'AVAILABLE')
              OR to_jsonb(t) ->> 'overall_status' IS NULL)::int AS active_trials,
            max(substring(to_jsonb(t) ->> 'start_date' from '^[0-9]{4}')::int) AS last_trial_year,
            coalesce(array_agg(DISTINCT t.phase) FILTER (WHERE t.phase IS NOT NULL AND t.obesity_class = 'primary'), '{}') AS trial_phases,
            ${HAS_INFO} AS has_info,
            (SELECT count(*)::int FROM product_abstracts pa WHERE pa.product_slug = p.slug) AS abstracts,
            (SELECT string_agg(DISTINCT pa.source, ', ') FROM product_abstracts pa WHERE pa.product_slug = p.slug) AS abstract_sources,
            NOT EXISTS (SELECT 1 FROM product_abstracts pa JOIN conference_abstracts ca USING (source, abstract_no)
                         WHERE pa.product_slug = p.slug AND to_jsonb(ca) ->> 'kind' IS DISTINCT FROM 'company_report') AS reports_only,
            ${OTHER_NAMES("p")} AS other_names
       FROM products p
       ${AUTO_JOIN}
       LEFT JOIN (trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active) ON tp.product_id = p.id
      WHERE p.kind IS NULL -- diets, procedures, tests and supplements are not listed (products.kind)
      GROUP BY p.id, x.ai
     -- drugs with trials, and drugs known only from conference abstracts (e.g. preclinical programs)
     HAVING count(t.nct_id) > 0 OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug)
      ORDER BY trials DESC, all_trials DESC, abstracts DESC, p.name`,
  );
}

export async function getProduct(slug: string): Promise<Product | null> {
  const rows = await query<Product>(
    // summary via to_jsonb: the page keeps working in the minute before migration 0016 runs.
    `SELECT p.id, p.slug, p.name, ${INFO_COLS}, p.info_updated_at,
            to_jsonb(p) ->> 'summary' AS summary, to_jsonb(p) ->> 'summary_updated_at' AS summary_updated_at,
            p.kind, p.kind_source, p.kind_note,
            ${AUTO_SHOWN} AS auto,
            (SELECT value FROM app_meta WHERE key = 'product_autofill_at') AS autofill_at,
            (SELECT count(*) FILTER (WHERE t.obesity_class = 'primary')::int
               FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
              WHERE tp.product_id = p.id) AS trials,
            (SELECT count(*)::int
               FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
              WHERE tp.product_id = p.id) AS all_trials,
            ${CONF_TRIALS} AS conference_trials
       FROM products p ${AUTO_JOIN} WHERE p.slug = $1`,
    [slug],
  );
  const p = rows[0];
  if (!p) return null;
  // No ClinicalTrials.gov trial yet: count the clinical trials its conference abstracts report.
  p.nct_trials = p.all_trials;
  if (p.all_trials === 0) { p.trials = p.conference_trials; p.all_trials = p.conference_trials; }
  else p.conference_trials = 0;
  return p;
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
        therapy_subclass = $14, indication = $15,
        inn = $16, api = $17, regulatory_status = $18, designations = $19, patents = $20,
        anticipated_launch = $21, efficacy_signal = $22, safety_signal = $23, info_updated_at = now()
      WHERE slug = $1
      RETURNING slug`,
    [
      slug, info.modality, info.phase, info.moa, info.roa, info.approved,
      info.approval_date, info.sponsor, info.drug_class,
      info.aliases, info.brand_names, info.candidate, info.parent_drug, info.therapy_subclass, info.indication,
      info.inn, info.api, info.regulatory_status, info.designations, info.patents,
      info.anticipated_launch, info.efficacy_signal, info.safety_signal,
    ],
  );
  return rows.length ? getProduct(slug) : null;
}

/** Keep a product in the drug list, or leave it out as a supplement / not a drug (a choice the automatic clean-up never changes). */
export async function updateProductKind(slug: string, kind: "drug" | "supplement" | "not_drug" | "other_drug"): Promise<Product | null> {
  const rows = await query<{ slug: string }>(
    `UPDATE products SET kind = $2, kind_source = 'manual', kind_note = $3 WHERE slug = $1 RETURNING slug`,
    [slug, kind === "drug" ? null : kind, kind === "drug" ? null : "set on the drug page"],
  );
  return rows.length ? getProduct(slug) : null;
}

// --------------------------------------------------------------------------- #
// Development & regulatory: results and milestones (0024)
// --------------------------------------------------------------------------- #
const RESULT_COLS = `id::int, kind, trial, phase, population, duration, dose, endpoint, result, comparator, reported,
  source_label, source_url, origin, hidden`;
const MILESTONE_COLS = `id::int, kind, title, detail, date_label, to_char(date_sort, 'YYYY-MM-DD') AS date_sort, status, region,
  source_label, source_url, origin, hidden`;
// Until migration 0024 has run, the tables are missing: show nothing rather than fail the page.
const noTable = <T,>(e: unknown): T[] => {
  if (/product_(results|milestones)/.test(String(e))) return [];
  throw e;
};

/** Efficacy and safety results of a drug: research-file rows first (in file order), then rows typed on the page. */
export async function getProductResults(slug: string, withHidden = false): Promise<ProductResult[]> {
  return query<ProductResult>(
    `SELECT ${RESULT_COLS} FROM product_results
      WHERE product_slug = $1 ${withHidden ? "" : "AND NOT hidden"}
      ORDER BY kind, (origin = 'manual'), sort, id`,
    [slug],
  ).catch(noTable<ProductResult>);
}

/** A drug's milestones by date (undated ones last). */
export async function getProductMilestones(slug: string, withHidden = false): Promise<ProductMilestone[]> {
  return query<ProductMilestone>(
    `SELECT ${MILESTONE_COLS} FROM product_milestones
      WHERE product_slug = $1 ${withHidden ? "" : "AND NOT hidden"}
      ORDER BY date_sort NULLS LAST, id`,
    [slug],
  ).catch(noTable<ProductMilestone>);
}

/** Each drug's next expected milestone (the earliest dated one; an undated one only if nothing is dated). */
export async function nextMilestones(): Promise<Map<string, UpcomingMilestone>> {
  const rows = await query<UpcomingMilestone>(
    `SELECT DISTINCT ON (m.product_slug) m.product_slug AS slug, p.name, m.kind, m.title, m.date_label,
            to_char(m.date_sort, 'YYYY-MM-DD') AS date_sort, m.region, m.source_url
       FROM product_milestones m JOIN products p ON p.slug = m.product_slug
      WHERE m.status IN ('expected', 'delayed') AND NOT m.hidden
      ORDER BY m.product_slug, m.date_sort NULLS LAST, m.id`,
  ).catch(noTable<UpcomingMilestone>);
  return new Map(rows.map((r) => [r.slug, r]));
}

/** Expected milestones across all listed drugs, soonest first (dated ones only). */
export async function upcomingMilestones(limit = 12): Promise<UpcomingMilestone[]> {
  return query<UpcomingMilestone>(
    `SELECT m.product_slug AS slug, p.name, m.kind, m.title, m.date_label, to_char(m.date_sort, 'YYYY-MM-DD') AS date_sort,
            m.region, m.source_url
       FROM product_milestones m JOIN products p ON p.slug = m.product_slug AND p.kind IS NULL
      WHERE m.status IN ('expected', 'delayed') AND NOT m.hidden AND m.date_sort IS NOT NULL
      ORDER BY m.date_sort, p.name, m.id
      LIMIT $1`,
    [limit],
  ).catch(noTable<UpcomingMilestone>);
}

export type ResultInput = Omit<ProductResult, "id" | "origin" | "hidden">;
export type MilestoneInput = Omit<ProductMilestone, "id" | "origin" | "hidden" | "date_sort">;

/** First day of the period a date label names: "2026-03-19", "2026-03", "2026-Q4", "2026-H2", "2027". */
export function milestoneDateSort(label: string | null): string | null {
  const s = (label ?? "").trim().toUpperCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isNaN(Date.parse(s)) ? null : s;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{4})-?Q([1-4])$/.exec(s);
  if (m) return `${m[1]}-${String((+m[2] - 1) * 3 + 1).padStart(2, "0")}-01`;
  m = /^(\d{4})-?H([12])$/.exec(s);
  if (m) return `${m[1]}-${m[2] === "1" ? "01" : "07"}-01`;
  m = /^(\d{4})$/.exec(s);
  return m ? `${m[1]}-01-01` : null;
}

export async function addResult(slug: string, r: ResultInput, by: string | null): Promise<ProductResult | null> {
  const rows = await query<ProductResult>(
    `INSERT INTO product_results (product_slug, kind, trial, phase, population, duration, dose, endpoint, result, comparator,
                                  reported, source_label, source_url, origin, created_by, sort)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'manual', $14,
            coalesce((SELECT max(sort) + 1 FROM product_results WHERE product_slug = $1), 0)
      WHERE EXISTS (SELECT 1 FROM products WHERE slug = $1)
     RETURNING ${RESULT_COLS}`,
    [slug, r.kind, r.trial, r.phase, r.population, r.duration, r.dose, r.endpoint, r.result, r.comparator, r.reported,
     r.source_label, r.source_url, by],
  );
  return rows[0] ?? null;
}

/** Change a row typed on the page. Research-file rows can only be hidden or shown (the sync would put them back). */
export async function updateResult(slug: string, id: number, r: ResultInput): Promise<ProductResult | null> {
  const rows = await query<ProductResult>(
    `UPDATE product_results SET kind = $3, trial = $4, phase = $5, population = $6, duration = $7, dose = $8, endpoint = $9,
            result = $10, comparator = $11, reported = $12, source_label = $13, source_url = $14, updated_at = now()
      WHERE product_slug = $1 AND id = $2 AND origin = 'manual'
      RETURNING ${RESULT_COLS}`,
    [slug, id, r.kind, r.trial, r.phase, r.population, r.duration, r.dose, r.endpoint, r.result, r.comparator, r.reported,
     r.source_label, r.source_url],
  );
  return rows[0] ?? null;
}

export async function setResultHidden(slug: string, id: number, hidden: boolean): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "UPDATE product_results SET hidden = $3, updated_at = now() WHERE product_slug = $1 AND id = $2 RETURNING id", [slug, id, hidden],
  );
  return rows.length > 0;
}

export async function deleteResult(slug: string, id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "DELETE FROM product_results WHERE product_slug = $1 AND id = $2 AND origin = 'manual' RETURNING id", [slug, id],
  );
  return rows.length > 0;
}

export async function addMilestone(slug: string, m: MilestoneInput, by: string | null): Promise<ProductMilestone | null> {
  const rows = await query<ProductMilestone>(
    `INSERT INTO product_milestones (product_slug, kind, title, detail, date_label, date_sort, status, region,
                                     source_label, source_url, origin, created_by)
     SELECT $1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, 'manual', $11
      WHERE EXISTS (SELECT 1 FROM products WHERE slug = $1)
     RETURNING ${MILESTONE_COLS}`,
    [slug, m.kind, m.title, m.detail, m.date_label, milestoneDateSort(m.date_label), m.status, m.region, m.source_label, m.source_url, by],
  );
  return rows[0] ?? null;
}

export async function updateMilestone(slug: string, id: number, m: MilestoneInput): Promise<ProductMilestone | null> {
  const rows = await query<ProductMilestone>(
    `UPDATE product_milestones SET kind = $3, title = $4, detail = $5, date_label = $6, date_sort = $7::date, status = $8,
            region = $9, source_label = $10, source_url = $11, updated_at = now()
      WHERE product_slug = $1 AND id = $2 AND origin = 'manual'
      RETURNING ${MILESTONE_COLS}`,
    [slug, id, m.kind, m.title, m.detail, m.date_label, milestoneDateSort(m.date_label), m.status, m.region, m.source_label, m.source_url],
  );
  return rows[0] ?? null;
}

export async function setMilestoneHidden(slug: string, id: number, hidden: boolean): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "UPDATE product_milestones SET hidden = $3, updated_at = now() WHERE product_slug = $1 AND id = $2 RETURNING id", [slug, id, hidden],
  );
  return rows.length > 0;
}

export async function deleteMilestone(slug: string, id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "DELETE FROM product_milestones WHERE product_slug = $1 AND id = $2 AND origin = 'manual' RETURNING id", [slug, id],
  );
  return rows.length > 0;
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
            -- the same drug count as the Overview's "Drugs" tile (homeStats)
            (SELECT count(DISTINCT tp.product_id)::int FROM trial_products tp
               JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active AND t.obesity_class = 'primary'
               JOIN products p ON p.id = tp.product_id AND p.kind IS NULL) AS products,
            (SELECT count(*)::int FROM products p
              WHERE p.kind IS NULL
                AND EXISTS (SELECT 1 FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id
                             WHERE tp.product_id = p.id AND t.is_active AND t.obesity_class = 'primary')
                AND (p.modality IS NOT NULL OR p.phase IS NOT NULL OR p.moa IS NOT NULL OR p.roa IS NOT NULL
                     OR p.approved IS NOT NULL OR p.approval_date IS NOT NULL OR p.sponsor IS NOT NULL
                     OR p.drug_class IS NOT NULL)) AS with_info`,
  );
  return {
    trials: r[0].trials, storedTrials: r[0].stored, noDrug: r[0].no_drug,
    products: r[0].products, productsWithInfo: r[0].with_info,
  };
}

export interface ConferenceAbstractRow {
  source: string; abstract_no: string; title: string | null; link: string | null; program: string | null;
  trial_ids: string[]; study_type: string | null; kind: string | null;
  sponsor: string | null; indication: string | null; stage: string | null; mechanism: string | null;
  model: string | null; key_finding: string | null;
}

/** Conference abstracts (e.g. ADA 2026) that name this drug. */
export async function getProductAbstracts(slug: string): Promise<ConferenceAbstractRow[]> {
  return query<ConferenceAbstractRow>(
    `SELECT a.source, a.abstract_no, a.title, a.link, a.program, a.sponsor, a.indication, a.stage, a.mechanism,
            a.model, a.key_finding, a.trial_ids, a.study_type, to_jsonb(a) ->> 'kind' AS kind
       FROM product_abstracts pa JOIN conference_abstracts a USING (source, abstract_no)
      WHERE pa.product_slug = $1
      ORDER BY a.source DESC, a.stage NULLS LAST, a.abstract_no`,
    [slug],
  ).catch(() => []); // before migration 0019
}

/** All product names (for the merge picker). */
export async function productNames(): Promise<{ slug: string; name: string }[]> {
  return query<{ slug: string; name: string }>(
    `SELECT p.slug, p.name FROM products p
      WHERE EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
         OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug)
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
    // Development & regulatory fields and rows typed on the page (0024; skipped before that migration).
    const dev = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'product_results'");
    if (dev.rowCount) {
      await client.query(
        `UPDATE products t SET ${DEV_FIELDS.map((f) => `${f} = coalesce(t.${f}, f.${f})`).join(", ")}
           FROM products f WHERE t.id = $2 AND f.id = $1`,
        [from.id, into.id],
      );
      await client.query("UPDATE product_results SET product_slug = $2 WHERE product_slug = $1 AND origin = 'manual'", [from.slug, into.slug]);
      await client.query("UPDATE product_milestones SET product_slug = $2 WHERE product_slug = $1 AND origin = 'manual'", [from.slug, into.slug]);
    }
    // Conference abstracts follow the drug.
    await client.query(
      `INSERT INTO product_abstracts (product_slug, source, abstract_no, drug_name, aliases)
       SELECT $2, source, abstract_no, drug_name, aliases FROM product_abstracts WHERE product_slug = $1
       ON CONFLICT DO NOTHING`,
      [from.slug, into.slug],
    );
    await client.query("DELETE FROM product_abstracts WHERE product_slug = $1", [from.slug]);
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
        WHERE p.name NOT ILIKE 'undisclosed%' AND p.name NOT ILIKE 'placebo%' AND p.kind IS NULL
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
             FROM products p
             LEFT JOIN (trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND ${SHOWN()}) ON tp.product_id = p.id
            WHERE p.kind IS NULL
              AND (p.name ILIKE $1 OR coalesce(${OTHER_NAMES("p")}, '') ILIKE $1
               -- "nn 9440" / "NN-9440" find NN9440: compare letters and digits only
               OR ($3 <> '' AND regexp_replace(lower(p.name || ',' || coalesce(${OTHER_NAMES("p")}, '')), '[^a-z0-9]', '', 'g') LIKE '%' || $3 || '%'))
            GROUP BY p.id
           HAVING count(t.nct_id) > 0 OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug)
            ORDER BY (p.name ILIKE $2) DESC, trials DESC LIMIT 6`,
          [like, `${q}%`, squashTerm(q)],
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

// --------------------------------------------------------------------------- #
// Drug-profile auto-fill overview (Quality page)
// --------------------------------------------------------------------------- #
export const AUTOFILL_FIELDS = [
  "candidate", "sponsor", "phase", "indication", "drug_class", "therapy_subclass", "moa", "modality", "roa",
  "aliases", "brand_names", "approved", "approval_date", "parent_drug",
] as const;

export interface AutofillOverview {
  last: {
    at: string; minutes: number; products: number; updated: number; stoppedEarly: boolean; sourcesDown: string[];
    openFDA?: { checked: number; found: number }; ChEMBL?: { checked: number; found: number };
    "Inxight Drugs"?: { checked: number; found: number };
    merged?: number; hiddenByRule?: number; abstracts?: number; newFromAbstracts?: number;
  } | null;
  sources: Record<string, { ok: boolean; detail: string; checkedAt: string; lastOkAt: string | null; failingSince: string | null; skipped?: boolean }>;
  drugs: number;
  coverage: { field: string; manual: number; auto: number; sources: Record<string, number> }[];
  hidden: { not_drug: number; supplement: number; other_drug: number; manual: number };
  review: { slug: string; name: string; kind: string; note: string | null }[]; // hidden by a name rule: worth a look
}

/** Where an automatic value came from, in a few groups ("Company pipeline (Roche) + ChEMBL" -> Company pipelines). */
export function sourceGroup(label: string): string {
  if (/Company pipeline/i.test(label)) return "Company pipelines";
  if (/openFDA/i.test(label)) return "openFDA";
  if (/ChEMBL/i.test(label)) return "ChEMBL";
  if (/Inxight/i.test(label)) return "Inxight Drugs";
  if (/abstract/i.test(label)) return "Conference abstracts";
  if (/ClinicalTrials\.gov|Trial|Industry|Academic|Generic/i.test(label)) return "Trials";
  return "Name rules";
}

export async function autofillOverview(): Promise<AutofillOverview> {
  const meta = await query<{ key: string; value: string }>(
    "SELECT key, value FROM app_meta WHERE key IN ('product_autofill_last', 'source_status')",
  );
  const json = (k: string) => { try { const v = meta.find((m) => m.key === k)?.value; return v ? JSON.parse(v) : null; } catch { return null; } };
  const listed = `p.kind IS NULL AND (
      EXISTS (SELECT 1 FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active WHERE tp.product_id = p.id)
      OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug))`;
  const fields = [...AUTOFILL_FIELDS];
  const [cov, src, total, hidden, review] = await Promise.all([
    query<{ field: string; manual: number; auto: number }>(
      `WITH d AS (SELECT to_jsonb(p) AS j FROM products p WHERE ${listed})
       SELECT f AS field,
              count(*) FILTER (WHERE d.j ->> f IS NOT NULL)::int AS manual,
              count(*) FILTER (WHERE d.j ->> f IS NULL AND d.j #>> ARRAY['auto_info', f, 'value'] IS NOT NULL)::int AS auto
         FROM d, unnest($1::text[]) f GROUP BY f`,
      [fields],
    ),
    query<{ field: string; source: string; n: number }>(
      `WITH d AS (SELECT to_jsonb(p) AS j FROM products p WHERE ${listed})
       SELECT f AS field, d.j #>> ARRAY['auto_info', f, 'source'] AS source, count(*)::int AS n
         FROM d, unnest($1::text[]) f
        WHERE d.j ->> f IS NULL AND d.j #>> ARRAY['auto_info', f, 'value'] IS NOT NULL
        GROUP BY 1, 2`,
      [fields],
    ),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM products p WHERE ${listed}`),
    query<{ not_drug: number; supplement: number; other_drug: number; manual: number }>(
      `SELECT count(*) FILTER (WHERE kind = 'not_drug')::int AS not_drug,
              count(*) FILTER (WHERE kind = 'supplement')::int AS supplement,
              count(*) FILTER (WHERE kind = 'other_drug')::int AS other_drug,
              count(*) FILTER (WHERE kind_source = 'manual')::int AS manual
         FROM products p
        WHERE EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id) OR kind_source = 'manual'`,
    ),
    query<{ slug: string; name: string; kind: string; note: string | null }>(
      `SELECT slug, name, kind, kind_note AS note FROM products WHERE kind_source = 'rule' ORDER BY created_at DESC, name LIMIT 100`,
    ),
  ]);
  const bySource = new Map<string, Record<string, number>>();
  for (const r of src) {
    const m = bySource.get(r.field) ?? {};
    const g = sourceGroup(r.source ?? "");
    m[g] = (m[g] ?? 0) + r.n;
    bySource.set(r.field, m);
  }
  return {
    last: json("product_autofill_last"),
    sources: json("source_status") ?? {},
    drugs: total[0]?.n ?? 0,
    coverage: fields.map((f) => {
      const c = cov.find((x) => x.field === f);
      return { field: f, manual: c?.manual ?? 0, auto: c?.auto ?? 0, sources: bySource.get(f) ?? {} };
    }),
    hidden: hidden[0] ?? { not_drug: 0, supplement: 0, other_drug: 0, manual: 0 },
    review,
  };
}
