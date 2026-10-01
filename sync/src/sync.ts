import { createHash } from "node:crypto";
import { config } from "./config.js";
import type { RawStudy } from "./ctgov-client.js";
import { iterateStudies } from "./ctgov-client.js";
import { mapStudy, type MappedTrial } from "./mapper.js";
import { pool, withTransaction, type Client } from "./db.js";
import { isObesityIndication } from "./obesity-filter.js";
import {
  PRODUCT_RULES_VERSION,
  builtinAliasMap,
  aliasTargets,
  buildKnownSet,
  deriveTrialProducts,
  type AliasMap,
  type ProductRef,
} from "./products.js";

/** Checksum of the registry fields we use: unchanged => nothing to write. */
function checksum(m: MappedTrial): string {
  return createHash("md5").update(JSON.stringify(m)).digest("hex");
}

export interface SyncResult {
  runId: string;
  fetched: number;
  upserted: number;
  unchanged: number;
  filtered: number;
  failed: number;
  pages: number;
  durationMs: number;
}

// --------------------------------------------------------------------------- #
// Product context: aliases (built-in + product_aliases table) and known products
// --------------------------------------------------------------------------- #
export interface ProductContext {
  aliases: AliasMap;
  known: Set<string>;
}

export async function loadAliases(): Promise<AliasMap> {
  const aliases = builtinAliasMap();
  const r = await pool.query<{ alias_slug: string; product_slug: string; product_name: string | null }>(
    "SELECT alias_slug, product_slug, product_name FROM product_aliases",
  );
  if (r.rowCount) {
    // Look up display names of the target products that already exist.
    const names = await pool.query<{ slug: string; name: string }>(
      "SELECT slug, name FROM products WHERE slug = ANY($1)",
      [r.rows.map((x) => x.product_slug)],
    );
    const nameOf = new Map(names.rows.map((x) => [x.slug, x.name]));
    for (const a of r.rows) {
      const slug = a.product_slug.trim();
      if (!a.alias_slug || !slug) continue;
      const ref = { slug, name: a.product_name || nameOf.get(slug) || slug };
      // Register both the key as written (combination keys contain "_") and its
      // alphanumeric form (how single names are looked up).
      const key = a.alias_slug.trim().toLowerCase();
      aliases.set(key, ref);
      aliases.set(key.replace(/[^a-z0-9]/g, ""), ref);
    }
  }
  return aliases;
}

/** Context for incremental syncs: known = alias targets + products already in 2+ trials. */
export async function loadProductContext(): Promise<ProductContext> {
  const aliases = await loadAliases();
  const known = aliasTargets(aliases);
  const r = await pool.query<{ slug: string }>(
    `SELECT p.slug FROM products p JOIN trial_products tp ON tp.product_id = p.id
      WHERE p.slug NOT LIKE '%\\_%' GROUP BY p.slug HAVING count(*) >= 2`,
  );
  for (const row of r.rows) known.add(row.slug);
  return { aliases, known };
}

/** Link one trial to its products (inside the caller's transaction). */
async function linkProducts(client: Client, nctId: string, products: ProductRef[]): Promise<void> {
  await client.query("DELETE FROM trial_products WHERE nct_id = $1", [nctId]);
  for (const p of products) {
    // Insert the product if new; never touch an existing product's manual fields.
    await client.query(
      `WITH p AS (
         INSERT INTO products (slug, name) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id
       )
       INSERT INTO trial_products (nct_id, product_id)
       SELECT $3, id FROM p
       ON CONFLICT DO NOTHING`,
      [p.slug, p.name, nctId],
    );
  }
}

/**
 * Upsert one trial (lean fields) and its product links in one transaction.
 * Returns true if a write happened, false if the stored checksum matched.
 */
async function upsertTrial(
  client: Client,
  mapped: MappedTrial,
  ctx: ProductContext,
): Promise<boolean> {
  // Checksum the registry data itself, so unchanged CT.gov records are skipped even
  // if the product-matching rules change (rule changes are applied by rebuildProducts).
  const sum = checksum(mapped);
  const { kept, products } = deriveTrialProducts(mapped.interventions, ctx.aliases, ctx.known);
  const row: MappedTrial = { ...mapped, interventions: kept };

  const existing = await client.query<{ source_checksum: string | null }>(
    "SELECT source_checksum FROM trials WHERE nct_id = $1",
    [row.nct_id],
  );
  if (existing.rowCount && existing.rows[0].source_checksum === sum) {
    await client.query("UPDATE trials SET fetched_at = now() WHERE nct_id = $1", [row.nct_id]);
    return false;
  }

  await client.query(
    `INSERT INTO trials (nct_id, phase, sponsor, lead_sponsor_class, conditions, interventions,
                         countries, continents, is_active, source_checksum, version, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, continents_of($7::text[]), true, $8, 1, now())
     ON CONFLICT (nct_id) DO UPDATE SET
        phase              = EXCLUDED.phase,
        sponsor            = EXCLUDED.sponsor,
        lead_sponsor_class = EXCLUDED.lead_sponsor_class,
        conditions         = EXCLUDED.conditions,
        interventions      = EXCLUDED.interventions,
        countries          = EXCLUDED.countries,
        continents         = EXCLUDED.continents,
        is_active          = true,
        source_checksum    = EXCLUDED.source_checksum,
        version            = trials.version + 1,
        fetched_at         = now()`,
    [
      row.nct_id, row.phase, row.sponsor, row.lead_sponsor_class,
      row.conditions, row.interventions, row.countries, sum,
    ],
  );
  await linkProducts(client, row.nct_id, products);
  return true;
}

/**
 * Core sync loop, shared by the live network sync and by tests.
 * `source` yields raw study payloads; `getPages` reports page progress.
 */
async function runSyncCore(
  source: AsyncIterable<RawStudy>,
  getPages: () => number = () => 0,
): Promise<SyncResult> {
  const started = Date.now();
  const ctx = await loadProductContext();

  const runRow = await pool.query<{ id: string }>(
    `INSERT INTO sync_runs (status, trials_fetched, trials_upserted, trials_failed, api_pages_consumed)
     VALUES ('running', 0, 0, 0, 0) RETURNING id`,
  );
  const runId = runRow.rows[0].id;

  let fetched = 0;
  let upserted = 0;
  let unchanged = 0;
  let filtered = 0;
  let failed = 0;
  let pages = 0;
  const errors: { nct_id: string; error: string }[] = [];

  try {
    for await (const raw of source) {
      pages = getPages();
      fetched += 1;
      const nctId = raw?.protocolSection?.identificationModule?.nctId ?? "UNKNOWN";
      try {
        const mapped = mapStudy(raw);
        if (!mapped.nct_id) throw new Error("missing nct_id");
        // Keep only primary-obesity-indication trials. A stored trial that no longer
        // qualifies (its conditions changed) is removed.
        if (config.ctgov.obesityIndicationOnly && !isObesityIndication(mapped.conditions)) {
          await pool.query("DELETE FROM trials WHERE nct_id = $1", [mapped.nct_id]);
          filtered += 1;
          continue;
        }
        const wrote = await withTransaction((c) => upsertTrial(c, mapped, ctx));
        if (wrote) upserted += 1;
        else unchanged += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ nct_id: nctId, error: msg });
        await pool.query(
          `INSERT INTO sync_failures (nct_id, failure_type, error_msg, retry_count, last_attempted)
           VALUES ($1, 'map_or_upsert', $2, 0, now())`,
          [nctId, msg],
        );
      }
    }

    pages = getPages();
    const status = failed === 0 ? "success" : "partial";
    await pool.query(
      `UPDATE sync_runs SET status=$2, trials_fetched=$3, trials_upserted=$4,
          trials_failed=$5, api_pages_consumed=$6, duration_ms=$7,
          error_detail=$8 WHERE id=$1`,
      [
        runId, status, fetched, upserted, failed, pages, Date.now() - started,
        errors.length ? JSON.stringify(errors.slice(0, 50)) : null,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sync_runs SET status='failed', trials_fetched=$2, trials_upserted=$3,
          trials_failed=$4, api_pages_consumed=$5, duration_ms=$6,
          error_detail=$7 WHERE id=$1`,
      [runId, fetched, upserted, failed, pages, Date.now() - started,
       JSON.stringify({ fatal: msg })],
    );
    throw err;
  }

  return {
    runId, fetched, upserted, unchanged, filtered, failed, pages,
    durationMs: Date.now() - started,
  };
}

/**
 * Run a sync against the live CT.gov API.
 *   full=false (default) — incremental: obesity trials with StartDate >= the
 *     configured floor (year 2000) AND updated in the last CTGOV_INCREMENTAL_DAYS days.
 *   full=true — full backfill: every obesity trial with StartDate >= the floor.
 */
export async function runSync(
  full = false,
  incrementalDaysOverride?: number,
): Promise<SyncResult> {
  const days = full ? null : (incrementalDaysOverride ?? config.ctgov.incrementalDays);
  const startDateFrom = config.ctgov.startDateFrom || null;
  let pageCount = 0;
  const source = iterateStudies({ incrementalDays: days, startDateFrom }, (pageIndex) => {
    pageCount = pageIndex + 1;
  });
  const result = await runSyncCore(source, () => pageCount);
  // A full backfill re-derives every product link with the corpus-wide known set.
  if (full) await rebuildProducts();
  return result;
}

/**
 * Whole days since the last successful/partial sync run, or null if there has
 * never been one. Used by the scheduler to size a catch-up window.
 */
export async function daysSinceLastSuccessfulSync(): Promise<number | null> {
  const r = await pool.query<{ last: Date | null }>(
    "SELECT max(run_at) AS last FROM sync_runs WHERE status IN ('success','partial')",
  );
  const last = r.rows[0]?.last;
  if (!last) return null;
  const ms = Date.now() - new Date(last).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Run the sync loop over an in-memory list of studies (no network). For tests. */
export async function runSyncForStudies(studies: RawStudy[]): Promise<SyncResult> {
  async function* gen() {
    for (const s of studies) yield s;
  }
  return runSyncCore(gen(), () => 1);
}

/** How many active trials are currently stored. */
export async function trialCount(): Promise<number> {
  const r = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM trials WHERE is_active = true",
  );
  return r.rows[0]?.c ?? 0;
}

// --------------------------------------------------------------------------- #
// Rebuild all product links (after a migration, rule change or alias edit)
// --------------------------------------------------------------------------- #
export interface RebuildResult {
  trials: number;
  products: number;        // products linked to at least one trial
  orphansRemoved: number;  // unlinked products with no manual info, deleted
  keptWithInfo: number;    // unlinked products kept because they have manual info
}

const MANUAL_INFO_EMPTY = `modality IS NULL AND phase IS NULL AND moa IS NULL AND roa IS NULL
  AND approved IS NULL AND approval_date IS NULL AND sponsor IS NULL AND drug_class IS NULL`;

/**
 * Re-derive products for every trial from trials.interventions, using the
 * corpus-wide "known products" set. Manual product info is preserved (products
 * are keyed by slug); unlinked products are deleted only if they hold no manual info.
 * Also picks the most common spelling as each product's display name.
 */
export async function rebuildProducts(): Promise<RebuildResult> {
  const aliases = await loadAliases();
  const rows = await pool.query<{ nct_id: string; interventions: string[] }>(
    "SELECT nct_id, interventions FROM trials WHERE is_active = true",
  );
  const known = buildKnownSet(rows.rows.map((r) => r.interventions ?? []), aliases);

  // Derive everything in memory first.
  const perTrial = new Map<string, { kept: string[]; products: ProductRef[] }>();
  const nameVotes = new Map<string, Map<string, number>>();
  for (const r of rows.rows) {
    const d = deriveTrialProducts(r.interventions ?? [], aliases, known);
    perTrial.set(r.nct_id, d);
    for (const p of d.products) {
      const votes = nameVotes.get(p.slug) ?? new Map<string, number>();
      votes.set(p.name, (votes.get(p.name) ?? 0) + 1);
      nameVotes.set(p.slug, votes);
    }
  }
  const aliasNames = new Map([...aliases.values()].map((a) => [a.slug, a.name]));
  const bestName = (slug: string) => {
    if (aliasNames.has(slug)) return aliasNames.get(slug)!;
    const votes = [...(nameVotes.get(slug) ?? new Map()).entries()];
    // most votes; ties -> prefer a capitalised INN-style spelling, then shortest
    votes.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    return votes[0]?.[0] ?? slug;
  };

  const result: RebuildResult = { trials: rows.rowCount ?? 0, products: nameVotes.size, orphansRemoved: 0, keptWithInfo: 0 };

  await withTransaction(async (c) => {
    // Upsert products with their best display name (manual fields untouched).
    const slugs = [...nameVotes.keys()];
    for (let i = 0; i < slugs.length; i += 500) {
      const chunk = slugs.slice(i, i + 500);
      await c.query(
        `INSERT INTO products (slug, name)
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
        [chunk, chunk.map(bestName)],
      );
    }
    const ids = await c.query<{ id: number; slug: string }>("SELECT id, slug FROM products");
    const idOf = new Map(ids.rows.map((r) => [r.slug, r.id]));

    await c.query("DELETE FROM trial_products");
    const nct: string[] = [];
    const pid: number[] = [];
    for (const [id, d] of perTrial) {
      for (const p of d.products) {
        nct.push(id);
        pid.push(idOf.get(p.slug)!);
      }
    }
    for (let i = 0; i < nct.length; i += 5000) {
      await c.query(
        `INSERT INTO trial_products (nct_id, product_id)
         SELECT * FROM unnest($1::text[], $2::int[]) ON CONFLICT DO NOTHING`,
        [nct.slice(i, i + 5000), pid.slice(i, i + 5000)],
      );
    }
    // Keep only the intervention names that named a product (drops placebos etc.).
    for (const [id, d] of perTrial) {
      await c.query(
        "UPDATE trials SET interventions = $2 WHERE nct_id = $1 AND interventions IS DISTINCT FROM $2",
        [id, d.kept],
      );
    }
    const kept = await c.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM products p
        WHERE NOT EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
          AND NOT (${MANUAL_INFO_EMPTY})`,
    );
    result.keptWithInfo = kept.rows[0].c;
    const del = await c.query(
      `DELETE FROM products p
        WHERE NOT EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
          AND ${MANUAL_INFO_EMPTY}`,
    );
    result.orphansRemoved = del.rowCount ?? 0;
    await c.query(
      `INSERT INTO app_meta (key, value) VALUES ('product_rules_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PRODUCT_RULES_VERSION],
    );
  });
  return result;
}

/** True when trial_products should be rebuilt (never built, or the rules changed). */
export async function productsNeedRebuild(): Promise<boolean> {
  const r = await pool.query<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'product_rules_version'",
  );
  return r.rows[0]?.value !== PRODUCT_RULES_VERSION;
}

// --------------------------------------------------------------------------- #
// Obesity-INDICATION cleanup
// --------------------------------------------------------------------------- #
export interface ObesityPruneResult {
  scanned: number;              // trials that HAVE conditions
  skippedNoConditions: number;  // trials with no condition data — left untouched
  keep: number;
  remove: number;
  sample: { nct_id: string; conditions: string[] }[];
}

/**
 * Delete stored trials whose PRIMARY indication is not obesity (dry-run unless
 * `apply`). They come back automatically only if CT.gov changes their conditions.
 */
export async function pruneNonObesityIndication(
  opts: { apply?: boolean } = {},
): Promise<ObesityPruneResult> {
  const rows = await pool.query<{ nct_id: string; conditions: string[] | null }>(
    "SELECT nct_id, conditions FROM trials",
  );
  const res: ObesityPruneResult = { scanned: 0, skippedNoConditions: 0, keep: 0, remove: 0, sample: [] };
  const toRemove: string[] = [];
  for (const r of rows.rows) {
    const conds = (r.conditions ?? []).filter(Boolean);
    if (!conds.length) { res.skippedNoConditions++; continue; }
    res.scanned++;
    if (isObesityIndication(conds)) {
      res.keep++;
    } else {
      res.remove++;
      toRemove.push(r.nct_id);
      if (res.sample.length < 25) res.sample.push({ nct_id: r.nct_id, conditions: conds.slice(0, 3) });
    }
  }
  if (opts.apply && toRemove.length) {
    for (let i = 0; i < toRemove.length; i += 1000) {
      await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [toRemove.slice(i, i + 1000)]);
    }
  }
  return res;
}
