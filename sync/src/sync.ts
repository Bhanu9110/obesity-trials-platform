import { config } from "./config.js";
import type { RawStudy } from "./ctgov-client.js";
import { iterateStudies } from "./ctgov-client.js";
import { PARSER_VERSION, contentHash, mapStudy, trimPayload, type MappedTrial } from "./mapper.js";
import { pool, withTransaction, type Client } from "./db.js";
import { isObesityIndication } from "./obesity-filter.js";
import { assessQuality } from "./quality.js";
import {
  PRODUCT_RULES_VERSION,
  builtinAliasMap,
  aliasTargets,
  buildKnownSet,
  deriveTrialProducts,
  type AliasMap,
  type ProductRef,
} from "./products.js";

const SOURCE = "CTGOV";
const ctgovUrl = (id: string) => `https://clinicaltrials.gov/study/${id}`;

export interface SyncResult {
  runId: string;
  fetched: number;
  upserted: number;   // new, changed, or re-parsed with a newer parser
  unchanged: number;  // same content hash and parser version — only last_seen_at touched
  filtered: number;   // not a primary-obesity trial (removed if it was stored)
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

// --------------------------------------------------------------------------- #
// Data quality
// --------------------------------------------------------------------------- #
async function writeQuality(
  client: Client,
  mapped: MappedTrial,
  kept: string[],
  productCount: number,
): Promise<void> {
  const geo = await client.query<{ continents: string[]; unknown: string[] }>(
    `SELECT continents,
            ARRAY(SELECT c FROM unnest(countries) c WHERE continent_of(c) = 'Other') AS unknown
       FROM trials WHERE nct_id = $1`,
    [mapped.nct_id],
  );
  const q = assessQuality(mapped, kept, productCount, geo.rows[0]?.continents ?? [], geo.rows[0]?.unknown ?? []);
  await client.query(
    `INSERT INTO trial_quality (trial_id, score, error_count, warning_count, info_count, issues, parser_version, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (trial_id) DO UPDATE SET
       score = EXCLUDED.score, error_count = EXCLUDED.error_count, warning_count = EXCLUDED.warning_count,
       info_count = EXCLUDED.info_count, issues = EXCLUDED.issues, parser_version = EXCLUDED.parser_version,
       checked_at = now()`,
    [mapped.nct_id, q.score, q.error_count, q.warning_count, q.info_count, JSON.stringify(q.issues), PARSER_VERSION],
  );
}

// --------------------------------------------------------------------------- #
// Writing one trial (shared by live sync and re-parse)
// --------------------------------------------------------------------------- #
/**
 * Write the canonical trial row, its source link, product links and quality
 * record (inside the caller's transaction). The trial's `version` and
 * `last_changed_at` only move when the mapped record actually changed.
 */
async function writeTrial(
  client: Client,
  mapped: MappedTrial,
  ctx: ProductContext,
  runId: string | null,
): Promise<void> {
  const recordHash = contentHash(mapped);
  const { kept, products } = deriveTrialProducts(mapped.interventions, ctx.aliases, ctx.known);

  await client.query(
    `INSERT INTO trials (nct_id, phase, sponsor, lead_sponsor_class, conditions, interventions,
                         countries, continents, source_updated_at, is_active, record_hash, version,
                         parser_version, last_run_id, first_seen_at, last_seen_at, last_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, continents_of($7::text[]), $8, true, $9, 1, $10, $11, now(), now(), now())
     ON CONFLICT (nct_id) DO UPDATE SET
        phase              = EXCLUDED.phase,
        sponsor            = EXCLUDED.sponsor,
        lead_sponsor_class = EXCLUDED.lead_sponsor_class,
        conditions         = EXCLUDED.conditions,
        interventions      = EXCLUDED.interventions,
        countries          = EXCLUDED.countries,
        continents         = EXCLUDED.continents,
        source_updated_at  = EXCLUDED.source_updated_at,
        is_active          = true,
        parser_version     = EXCLUDED.parser_version,
        last_seen_at       = now(),
        version            = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN trials.version + 1 ELSE trials.version END,
        last_changed_at    = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN now() ELSE trials.last_changed_at END,
        last_run_id        = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN EXCLUDED.last_run_id ELSE trials.last_run_id END,
        record_hash        = EXCLUDED.record_hash`,
    [
      mapped.nct_id, mapped.phase, mapped.sponsor, mapped.lead_sponsor_class, mapped.conditions,
      kept, mapped.countries, mapped.source_updated_at, recordHash, PARSER_VERSION, runId,
    ],
  );
  await client.query(
    `INSERT INTO trial_sources (source, source_id, trial_id, source_url, is_primary, source_updated_at, first_seen_at, last_seen_at)
     VALUES ($1, $2, $2, $3, true, $4, now(), now())
     ON CONFLICT (source, source_id) DO UPDATE SET
       trial_id = EXCLUDED.trial_id, source_url = EXCLUDED.source_url,
       source_updated_at = EXCLUDED.source_updated_at, last_seen_at = now()`,
    [SOURCE, mapped.nct_id, ctgovUrl(mapped.nct_id), mapped.source_updated_at],
  );
  await linkProducts(client, mapped.nct_id, products);
  await writeQuality(client, mapped, kept, products.length);
}

/** Remove a stored trial (and its raw record): it is no longer in scope. */
async function deleteTrial(client: Client | typeof pool, nctId: string): Promise<void> {
  await client.query("DELETE FROM trials WHERE nct_id = $1", [nctId]); // cascades sources/products/quality
  await client.query("DELETE FROM raw_trials WHERE source = $1 AND source_id = $2", [SOURCE, nctId]);
}

type IngestOutcome = "upserted" | "unchanged" | "filtered";

/**
 * Ingest one CT.gov record: trim to the fields we use, hash, and skip it when
 * the content hash and parser version are unchanged (only `last_seen_at` moves).
 */
async function ingestStudy(client: Client, raw: RawStudy, ctx: ProductContext, runId: string | null): Promise<IngestOutcome> {
  const payload = trimPayload(raw);
  const mapped = mapStudy(payload);
  if (!mapped.nct_id) throw new Error("missing nct_id");

  // Keep only primary-obesity-indication trials; drop one that stopped qualifying.
  if (config.ctgov.obesityIndicationOnly && !isObesityIndication(mapped.conditions)) {
    await deleteTrial(client, mapped.nct_id);
    return "filtered";
  }

  const hash = contentHash(payload);
  const prev = await client.query<{ content_hash: string; parser_version: string; has_trial: boolean }>(
    `SELECT r.content_hash, r.parser_version,
            EXISTS (SELECT 1 FROM trials t WHERE t.nct_id = r.source_id) AS has_trial
       FROM raw_trials r WHERE r.source = $1 AND r.source_id = $2`,
    [SOURCE, mapped.nct_id],
  );
  const p = prev.rows[0];
  if (p && p.content_hash === hash && p.parser_version === PARSER_VERSION && p.has_trial) {
    await client.query("UPDATE raw_trials SET last_seen_at = now() WHERE source = $1 AND source_id = $2", [SOURCE, mapped.nct_id]);
    await client.query("UPDATE trial_sources SET last_seen_at = now() WHERE source = $1 AND source_id = $2", [SOURCE, mapped.nct_id]);
    await client.query("UPDATE trials SET last_seen_at = now() WHERE nct_id = $1", [mapped.nct_id]);
    return "unchanged";
  }

  await client.query(
    `INSERT INTO raw_trials (source, source_id, payload, content_hash, parser_version, source_updated_at,
                             first_seen_at, last_seen_at, last_changed_at, last_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now(), $7)
     ON CONFLICT (source, source_id) DO UPDATE SET
       payload           = EXCLUDED.payload,
       parser_version    = EXCLUDED.parser_version,
       source_updated_at = EXCLUDED.source_updated_at,
       last_seen_at      = now(),
       last_changed_at   = CASE WHEN raw_trials.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                                THEN now() ELSE raw_trials.last_changed_at END,
       last_run_id       = CASE WHEN raw_trials.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                                THEN EXCLUDED.last_run_id ELSE raw_trials.last_run_id END,
       content_hash      = EXCLUDED.content_hash`,
    [SOURCE, mapped.nct_id, JSON.stringify(payload), hash, PARSER_VERSION, mapped.source_updated_at, runId],
  );
  await writeTrial(client, mapped, ctx, runId);
  return "upserted";
}

// --------------------------------------------------------------------------- #
// Sync loop
// --------------------------------------------------------------------------- #
async function startRun(mode: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO sync_runs (status, mode, parser_version, trials_fetched, trials_upserted, trials_failed,
                            trials_unchanged, trials_filtered, api_pages_consumed)
     VALUES ('running', $1, $2, 0, 0, 0, 0, 0, 0) RETURNING id`,
    [mode, PARSER_VERSION],
  );
  return r.rows[0].id;
}

async function finishRun(runId: string, res: Omit<SyncResult, "runId" | "durationMs">, started: number,
                         errors: { nct_id: string; error: string }[], fatal?: string): Promise<void> {
  const status = fatal ? "failed" : res.failed === 0 ? "success" : "partial";
  await pool.query(
    `UPDATE sync_runs SET status=$2, trials_fetched=$3, trials_upserted=$4, trials_failed=$5,
        trials_unchanged=$6, trials_filtered=$7, api_pages_consumed=$8, duration_ms=$9, error_detail=$10
      WHERE id=$1`,
    [
      runId, status, res.fetched, res.upserted, res.failed, res.unchanged, res.filtered, res.pages,
      Date.now() - started,
      fatal ? JSON.stringify({ fatal }) : errors.length ? JSON.stringify(errors.slice(0, 50)) : null,
    ],
  );
}

/**
 * Core sync loop, shared by the live network sync and by tests.
 * `source` yields raw study payloads; `getPages` reports page progress.
 */
async function runSyncCore(
  source: AsyncIterable<RawStudy>,
  getPages: () => number = () => 0,
  mode = "incremental",
): Promise<SyncResult> {
  const started = Date.now();
  const ctx = await loadProductContext();
  const runId = await startRun(mode);
  const res = { fetched: 0, upserted: 0, unchanged: 0, filtered: 0, failed: 0, pages: 0 };
  const errors: { nct_id: string; error: string }[] = [];

  try {
    for await (const raw of source) {
      res.pages = getPages();
      res.fetched += 1;
      const nctId = raw?.protocolSection?.identificationModule?.nctId ?? "UNKNOWN";
      try {
        const outcome = await withTransaction((c) => ingestStudy(c, raw, ctx, runId));
        res[outcome] += 1;
      } catch (err) {
        res.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ nct_id: nctId, error: msg });
        await pool.query(
          `INSERT INTO sync_failures (nct_id, failure_type, error_msg, retry_count, last_attempted)
           VALUES ($1, 'map_or_upsert', $2, 0, now())`,
          [nctId, msg],
        );
      }
    }
    res.pages = getPages();
    await finishRun(runId, res, started, errors);
  } catch (err) {
    await finishRun(runId, res, started, errors, err instanceof Error ? err.message : String(err));
    throw err;
  }
  return { runId, ...res, durationMs: Date.now() - started };
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
  const result = await runSyncCore(source, () => pageCount, full ? "full" : "incremental");
  // A full backfill re-derives every product link with the corpus-wide known set.
  if (full) await rebuildProducts();
  return result;
}

// --------------------------------------------------------------------------- #
// Re-parse from raw_trials (no network)
// --------------------------------------------------------------------------- #
export interface ReparseResult {
  runId: string;
  scanned: number;
  reparsed: number;
  filtered: number;
  failed: number;
}

/**
 * Re-map stored raw records with the current parser. By default only records
 * parsed by an older PARSER_VERSION; `all` re-parses everything. Then rebuilds
 * product links corpus-wide.
 */
export async function reparseFromRaw(opts: { all?: boolean } = {}): Promise<ReparseResult> {
  const started = Date.now();
  const runId = await startRun("reparse");
  const rows = await pool.query<{ source_id: string; payload: RawStudy }>(
    `SELECT source_id, payload FROM raw_trials
      WHERE source = $1 AND ($2 OR parser_version <> $3)`,
    [SOURCE, Boolean(opts.all), PARSER_VERSION],
  );
  const ctx = await loadProductContext();
  const out: ReparseResult = { runId, scanned: rows.rowCount ?? 0, reparsed: 0, filtered: 0, failed: 0 };
  const errors: { nct_id: string; error: string }[] = [];
  for (const r of rows.rows) {
    try {
      await withTransaction(async (c) => {
        const mapped = mapStudy(r.payload);
        if (config.ctgov.obesityIndicationOnly && !isObesityIndication(mapped.conditions)) {
          await deleteTrial(c, r.source_id);
          out.filtered += 1;
          return;
        }
        await writeTrial(c, mapped, ctx, runId);
        await c.query("UPDATE raw_trials SET parser_version = $3 WHERE source = $1 AND source_id = $2",
          [SOURCE, r.source_id, PARSER_VERSION]);
        out.reparsed += 1;
      });
    } catch (err) {
      out.failed += 1;
      errors.push({ nct_id: r.source_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await finishRun(runId, { fetched: out.scanned, upserted: out.reparsed, unchanged: 0, filtered: out.filtered,
    failed: out.failed, pages: 0 }, started, errors);
  if (out.reparsed) await rebuildProducts();
  return out;
}

async function getMeta(key: string): Promise<string | null> {
  const r = await pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}
async function setMeta(key: string, value: string): Promise<void> {
  await pool.query(
    "INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}

/** Stored raw records parsed by an older parser version. */
export async function rawNeedingReparse(): Promise<number> {
  const r = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM raw_trials WHERE source = $1 AND parser_version <> $2",
    [SOURCE, PARSER_VERSION],
  );
  return r.rows[0].c;
}

/**
 * Trials with no source/raw record yet (databases upgraded from before lineage
 * tracking). A one-off full sync fills in raw_trials, trial_sources and
 * source_updated_at for them.
 */
export async function trialsMissingLineage(): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM trials t
      WHERE NOT EXISTS (SELECT 1 FROM trial_sources s WHERE s.trial_id = t.nct_id)`,
  );
  return r.rows[0].c;
}

/**
 * Bring the database up to date before a sync (used by the scheduler on start
 * and by the daily job). Returns true if it already ran a full backfill.
 *   - empty database               -> full backfill
 *   - trials with no lineage yet   -> full backfill (fills raw_trials, trial_sources,
 *                                     source_updated_at for databases upgraded from v1)
 *   - raw parsed by an old parser  -> re-parse from raw_trials (no network)
 *   - product rules changed        -> rebuild product links
 */
export async function upgradeIfNeeded(log: (msg: string, obj?: unknown) => void): Promise<boolean> {
  if ((await trialCount()) === 0) {
    log("database empty — running full backfill");
    log("backfill complete", await runSync(true));
    return true;
  }
  const missing = await trialsMissingLineage();
  if (missing > 0 && !(await getMeta("lineage_backfill_at"))) {
    log(`${missing} trial(s) have no source record yet — running a one-off full sync to fill in lineage`);
    log("lineage backfill complete", await runSync(true));
    await setMeta("lineage_backfill_at", new Date().toISOString()); // only after a successful full run
    const left = await trialsMissingLineage();
    if (left > 0) log(`${left} stored trial(s) were not returned by CT.gov and still have no source record`);
    return true;
  }
  const stale = await rawNeedingReparse();
  if (stale > 0) {
    log(`${stale} raw record(s) parsed by an older parser — re-parsing (no download)`);
    log("re-parse complete", await reparseFromRaw());
  }
  if (await productsNeedRebuild()) log("products rebuilt", await rebuildProducts());
  return false;
}

/** Recompute trial_quality for every stored trial from its raw record (no network). */
export async function refreshQuality(context?: ProductContext): Promise<number> {
  const ctx = context ?? (await loadProductContext());
  const rows = await pool.query<{ payload: RawStudy }>(
    `SELECT r.payload FROM raw_trials r JOIN trials t ON t.nct_id = r.source_id WHERE r.source = $1`,
    [SOURCE],
  );
  let n = 0;
  await withTransaction(async (c) => {
    for (const r of rows.rows) {
      const mapped = mapStudy(r.payload);
      const { kept, products } = deriveTrialProducts(mapped.interventions, ctx.aliases, ctx.known);
      await writeQuality(c, mapped, kept, products.length);
      n += 1;
    }
  });
  return n;
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
  return runSyncCore(gen(), () => 1, "test");
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
  // Product matches feed the quality checks (NO_DRUG_PRODUCT etc.).
  await refreshQuality({ aliases, known });
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
      const chunk = toRemove.slice(i, i + 1000);
      await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [chunk]);
      await pool.query("DELETE FROM raw_trials WHERE source = $1 AND source_id = ANY($2)", [SOURCE, chunk]);
    }
  }
  return res;
}
