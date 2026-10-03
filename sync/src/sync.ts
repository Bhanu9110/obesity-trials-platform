import { config } from "./config.js";
import type { RawStudy } from "./ctgov-client.js";
import { iterateStudies } from "./ctgov-client.js";
import { PARSER_VERSION, contentHash, mapStudy, studyTitle, trimPayload, type MappedTrial } from "./mapper.js";
import { pool, withTransaction, type Client } from "./db.js";
import { CLASSIFIER_VERSION, classifyObesity } from "./obesity-filter.js";
import { assessQuality } from "./quality.js";
import { validateMapped, type ValidationResult } from "./validate.js";
import { diffMapped, insertChanges, snapshot, type ChangeRow } from "./history.js";
import {
  dueFailures, openFailureIds, recordFailure, resolveFailures, type FailureType,
} from "./failures.js";
import {
  PRODUCT_RULES_VERSION,
  builtinAliasMap,
  aliasTargets,
  buildKnownSet,
  deriveTrialProducts,
  isUndisclosedProduct,
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
  filtered: number;   // not a primary-obesity trial (stored and labelled, hidden by default)
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

// --------------------------------------------------------------------------- #
// Batched writes
//
// The hosted database can be far away (GitHub's runners are in the US, the
// Supabase project may be in Mumbai: ~200 ms per round trip). So trials are
// written in batches — a handful of set-based statements per batch of a few
// hundred trials — instead of ~10 statements per trial.
// --------------------------------------------------------------------------- #
const BATCH_SIZE = Math.max(1, Number(process.env.SYNC_BATCH_SIZE ?? 250));

type Db = Client | typeof pool;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface QualityInput {
  mapped: MappedTrial;
  kept: string[];
  productCount: number;
  warnings: string[];
  /** product names when every product is an "Undisclosed <class>" one */
  undisclosedOnly?: string[];
}

const undisclosedOnly = (products: ProductRef[]) =>
  products.length && products.every((p) => isUndisclosedProduct(p.slug)) ? products.map((p) => p.name) : [];

/** Compute and store trial_quality for a set of stored trials (two round trips). */
async function writeQualityBatch(db: Db, items: QualityInput[]): Promise<void> {
  if (!items.length) return;
  const geo = await db.query<{ nct_id: string; continents: string[]; unknown: string[] }>(
    `SELECT nct_id, continents,
            ARRAY(SELECT c FROM unnest(countries) c WHERE continent_of(c) = 'Other') AS unknown
       FROM trials WHERE nct_id = ANY($1)`,
    [items.map((i) => i.mapped.nct_id)],
  );
  const geoOf = new Map(geo.rows.map((g) => [g.nct_id, g]));
  const rows = items
    .filter((i) => geoOf.has(i.mapped.nct_id))
    .map((i) => {
      const g = geoOf.get(i.mapped.nct_id)!;
      const q = assessQuality(i.mapped, i.kept, i.productCount, g.continents ?? [], g.unknown ?? [], i.warnings, i.undisclosedOnly ?? []);
      return {
        trial_id: i.mapped.nct_id, score: q.score, error_count: q.error_count,
        warning_count: q.warning_count, info_count: q.info_count, issues: q.issues,
      };
    });
  if (!rows.length) return;
  await db.query(
    `INSERT INTO trial_quality (trial_id, score, error_count, warning_count, info_count, issues, parser_version, checked_at)
     SELECT x.trial_id, x.score, x.error_count, x.warning_count, x.info_count, x.issues, $2, now()
       FROM jsonb_to_recordset($1::jsonb)
         AS x(trial_id text, score numeric, error_count int, warning_count int, info_count int, issues jsonb)
     ON CONFLICT (trial_id) DO UPDATE SET
       score = EXCLUDED.score, error_count = EXCLUDED.error_count, warning_count = EXCLUDED.warning_count,
       info_count = EXCLUDED.info_count, issues = EXCLUDED.issues, parser_version = EXCLUDED.parser_version,
       checked_at = now()`,
    [JSON.stringify(rows), PARSER_VERSION],
  );
}

/** Keep the last occurrence of each trial (a statement can't upsert one row twice). */
function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const m = new Map<string, T>();
  for (const it of items) m.set(key(it), it);
  return [...m.values()];
}

/** A parsed, validated trial ready to be written. */
interface TrialInput {
  mapped: MappedTrial;
  warnings: string[];
  /** registry brief title — only used to classify industry trials */
  title?: string | null;
}

const classify = (m: MappedTrial, title?: string | null) => classifyObesity(m.conditions, m.lead_sponsor_class, title);

/** Parse + validate a stored or downloaded payload. */
function parseAndValidate(payload: RawStudy): ValidationResult {
  return validateMapped(mapStudy(payload));
}

/**
 * Write canonical trial rows (with their obesity classification), source links,
 * product links and quality records for a batch (inside the caller's
 * transaction). A trial's `version` / `last_changed_at` only move when its record
 * really changed. Classification changes are written to the change history.
 * Returns the IDs that already existed before this write.
 */
async function writeTrialsBatch(
  c: Client,
  trials: TrialInput[],
  ctx: ProductContext,
  runId: string | null,
): Promise<Set<string>> {
  const list = dedupe(trials, (t) => t.mapped.nct_id);
  if (!list.length) return new Set();
  const derived = list.map(({ mapped: m, warnings, title }) => ({
    m,
    warnings,
    cls: classify(m, title),
    ...deriveTrialProducts(m.interventions, ctx.aliases, ctx.known),
  }));
  const ids = list.map((t) => t.mapped.nct_id);

  const prev = await c.query<{ nct_id: string; obesity_class: string }>(
    "SELECT nct_id, obesity_class FROM trials WHERE nct_id = ANY($1)",
    [ids],
  );
  const prevClass = new Map(prev.rows.map((r) => [r.nct_id, r.obesity_class]));

  await c.query(
    `INSERT INTO trials (nct_id, phase, sponsor, lead_sponsor_class, conditions, interventions,
                         countries, continents, source_updated_at, is_active, record_hash, version,
                         parser_version, last_run_id, first_seen_at, last_seen_at, last_changed_at,
                         obesity_class, obesity_reason, obesity_terms, classifier_version)
     SELECT x.nct_id, x.phase, x.sponsor, x.lead_sponsor_class, x.conditions, x.interventions,
            x.countries, continents_of(x.countries), x.source_updated_at, true, x.record_hash, 1,
            $2, $3, now(), now(), now(),
            x.obesity_class, x.obesity_reason, x.obesity_terms, $4
       FROM jsonb_to_recordset($1::jsonb)
         AS x(nct_id text, phase text, sponsor text, lead_sponsor_class text, conditions text[],
              interventions text[], countries text[], source_updated_at date, record_hash text,
              obesity_class text, obesity_reason text, obesity_terms text[])
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
        obesity_class      = EXCLUDED.obesity_class,
        obesity_reason     = EXCLUDED.obesity_reason,
        obesity_terms      = EXCLUDED.obesity_terms,
        classifier_version = EXCLUDED.classifier_version,
        last_seen_at       = now(),
        version            = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN trials.version + 1 ELSE trials.version END,
        last_changed_at    = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN now() ELSE trials.last_changed_at END,
        last_run_id        = CASE WHEN trials.record_hash IS DISTINCT FROM EXCLUDED.record_hash
                                  THEN EXCLUDED.last_run_id ELSE trials.last_run_id END,
        record_hash        = EXCLUDED.record_hash`,
    [
      JSON.stringify(derived.map(({ m, kept, cls }) => ({
        nct_id: m.nct_id, phase: m.phase, sponsor: m.sponsor, lead_sponsor_class: m.lead_sponsor_class,
        conditions: m.conditions, interventions: kept, countries: m.countries,
        source_updated_at: m.source_updated_at, record_hash: contentHash(m),
        obesity_class: cls.class, obesity_reason: cls.reason, obesity_terms: cls.terms,
      }))),
      PARSER_VERSION,
      runId,
      CLASSIFIER_VERSION,
    ],
  );

  await c.query(
    `INSERT INTO trial_sources (source, source_id, trial_id, source_url, is_primary, source_updated_at, first_seen_at, last_seen_at)
     SELECT $1, x.id, x.id, x.url, true, x.updated, now(), now()
       FROM jsonb_to_recordset($2::jsonb) AS x(id text, url text, updated date)
     ON CONFLICT (source, source_id) DO UPDATE SET
       trial_id = EXCLUDED.trial_id, source_url = EXCLUDED.source_url,
       source_updated_at = EXCLUDED.source_updated_at, last_seen_at = now()`,
    [SOURCE, JSON.stringify(list.map(({ mapped: m }) => ({ id: m.nct_id, url: ctgovUrl(m.nct_id), updated: m.source_updated_at })))],
  );

  // Product links: replace this batch's links. New products are inserted; an
  // existing product's name and manual fields are never touched here.
  await c.query("DELETE FROM trial_products WHERE nct_id = ANY($1)", [ids]);
  const links = derived.flatMap(({ m, products }) => products.map((p) => ({ nct_id: m.nct_id, slug: p.slug, name: p.name })));
  if (links.length) {
    const firstName = dedupe([...links].reverse(), (l) => l.slug); // first spelling seen per slug
    await c.query(
      `INSERT INTO products (slug, name)
       SELECT x.slug, x.name FROM jsonb_to_recordset($1::jsonb) AS x(slug text, name text)
       ON CONFLICT (slug) DO NOTHING`,
      [JSON.stringify(firstName.map((l) => ({ slug: l.slug, name: l.name })))],
    );
    await c.query(
      `INSERT INTO trial_products (nct_id, product_id)
       SELECT x.nct_id, p.id
         FROM jsonb_to_recordset($1::jsonb) AS x(nct_id text, slug text)
         JOIN products p ON p.slug = x.slug
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(links.map((l) => ({ nct_id: l.nct_id, slug: l.slug })))],
    );
  }

  await writeQualityBatch(c, derived.map(({ m, kept, products, warnings }) => ({
    mapped: m, kept, productCount: products.length, warnings, undisclosedOnly: undisclosedOnly(products),
  })));

  const reclassified: ChangeRow[] = derived
    .filter(({ m, cls }) => prevClass.has(m.nct_id) && prevClass.get(m.nct_id) !== cls.class)
    .map(({ m, cls }) => ({
      trial_id: m.nct_id, change: "reclassified", field: "obesity_class",
      old_value: prevClass.get(m.nct_id), new_value: cls.class,
    }));
  await insertChanges(c, reclassified, runId);
  return new Set(prevClass.keys());
}

/** Remove stored trials (and their raw records), recording them in the change history. */
async function deleteTrials(db: Db, nctIds: string[], runId: string | null = null): Promise<number> {
  if (!nctIds.length) return 0;
  const del = await db.query<{ nct_id: string; phase: string | null; sponsor: string | null; obesity_class: string }>(
    "DELETE FROM trials WHERE nct_id = ANY($1) RETURNING nct_id, phase, sponsor, obesity_class", // cascades sources/products/quality
    [nctIds],
  );
  await db.query("DELETE FROM raw_trials WHERE source = $1 AND source_id = ANY($2)", [SOURCE, nctIds]);
  await insertChanges(db, del.rows.map((r) => ({
    trial_id: r.nct_id, change: "removed" as const, field: null, old_value: snapshot(r), new_value: null,
  })), runId);
  return del.rowCount ?? 0;
}

interface Prepared {
  nct_id: string;
  payload: RawStudy;
  mapped: MappedTrial;
  warnings: string[];
  title: string | null;
  hash: string;
}

/** Upsert raw records (content hash, parser version, timestamps) for a batch. */
async function upsertRawBatch(c: Client, items: Prepared[], runId: string | null): Promise<void> {
  if (!items.length) return;
  await c.query(
    `INSERT INTO raw_trials (source, source_id, payload, content_hash, parser_version, source_updated_at,
                             first_seen_at, last_seen_at, last_changed_at, last_run_id)
     SELECT $1, x.id, x.payload, x.hash, $2, x.updated, now(), now(), now(), $3
       FROM jsonb_to_recordset($4::jsonb) AS x(id text, payload jsonb, hash text, updated date)
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
    [
      SOURCE, PARSER_VERSION, runId,
      JSON.stringify(items.map((p) => ({ id: p.nct_id, payload: p.payload, hash: p.hash, updated: p.mapped.source_updated_at }))),
    ],
  );
}

// --------------------------------------------------------------------------- #
// Sync loop
// --------------------------------------------------------------------------- #
async function startRun(mode: string): Promise<string> {
  // A run that never finished (job time limit, crash) is closed as failed.
  await pool.query(
    `UPDATE sync_runs SET status = 'failed',
            error_detail = jsonb_build_object('fatal', 'did not finish (stopped by a time limit or crash)')
      WHERE status = 'running' AND run_at < now() - interval '2 hours'`,
  );
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

type Counts = { fetched: number; upserted: number; unchanged: number; filtered: number; failed: number; pages: number };

interface RunState {
  ctx: ProductContext;
  runId: string | null;
  res: Counts;
  errors: { nct_id: string; error: string }[];
  openFailures: Set<string>;   // trials with an open retry / dead-letter entry
  touched: Set<string>;        // trials seen in this run (for retry-queue resolution)
}

async function fail(state: RunState, nctId: string, type: FailureType, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  state.res.failed += 1;
  state.errors.push({ nct_id: nctId, error: msg });
  await recordFailure(nctId, type, msg, state.runId);
  state.openFailures.add(nctId);
}

/**
 * Ingest a batch of CT.gov records: trim to the fields we use, parse, validate,
 * classify, skip unchanged records (same content hash and parser — only
 * `last_seen_at` moves) and write the rest in one transaction, with change
 * history. If that transaction fails, the batch is retried trial by trial so one
 * bad record can't block the others; failures go to the retry queue.
 */
async function ingestBatch(raws: RawStudy[], state: RunState): Promise<void> {
  const { ctx, runId, res } = state;
  const prepared: Prepared[] = [];
  for (const raw of raws) {
    const nctId = raw?.protocolSection?.identificationModule?.nctId ?? "UNKNOWN";
    try {
      const payload = trimPayload(raw);
      const v = parseAndValidate(payload);
      if (v.errors.length) {
        await fail(state, String(nctId), "validation", new Error(v.errors.join(" ")));
        continue;
      }
      prepared.push({
        nct_id: v.value.nct_id, payload, mapped: v.value, warnings: v.warnings,
        title: studyTitle(payload), hash: contentHash(payload),
      });
    } catch (err) {
      await fail(state, String(nctId), "map_or_upsert", err);
    }
  }
  const items = dedupe(prepared, (p) => p.nct_id);
  if (!items.length) return;
  // Not a primary-obesity trial: stored and labelled, hidden on the website by default.
  res.filtered += items.filter((p) => classify(p.mapped, p.title).class !== "primary").length;

  const prev = await pool.query<{ source_id: string; content_hash: string; parser_version: string; has_trial: boolean }>(
    `SELECT r.source_id, r.content_hash, r.parser_version,
            EXISTS (SELECT 1 FROM trials t WHERE t.nct_id = r.source_id) AS has_trial
       FROM raw_trials r WHERE r.source = $1 AND r.source_id = ANY($2)`,
    [SOURCE, items.map((p) => p.nct_id)],
  );
  const prevOf = new Map(prev.rows.map((r) => [r.source_id, r]));
  const unchanged: string[] = [];
  const changed: Prepared[] = [];
  for (const p of items) {
    const o = prevOf.get(p.nct_id);
    if (o && o.content_hash === p.hash && o.parser_version === PARSER_VERSION && o.has_trial) unchanged.push(p.nct_id);
    else changed.push(p);
  }
  const succeeded: string[] = [...unchanged];

  if (unchanged.length) {
    await pool.query("UPDATE raw_trials SET last_seen_at = now() WHERE source = $1 AND source_id = ANY($2)", [SOURCE, unchanged]);
    await pool.query("UPDATE trial_sources SET last_seen_at = now() WHERE source = $1 AND source_id = ANY($2)", [SOURCE, unchanged]);
    await pool.query("UPDATE trials SET last_seen_at = now() WHERE nct_id = ANY($1)", [unchanged]);
    res.unchanged += unchanged.length;
  }

  const write = (group: Prepared[]) =>
    withTransaction(async (c) => {
      // What the registry said before (for field-level change history).
      const before = await c.query<{ source_id: string; payload: RawStudy }>(
        "SELECT source_id, payload FROM raw_trials WHERE source = $1 AND source_id = ANY($2)",
        [SOURCE, group.map((p) => p.nct_id)],
      );
      const beforeOf = new Map(before.rows.map((r) => [r.source_id, r.payload]));
      await upsertRawBatch(c, group, runId);
      const existed = await writeTrialsBatch(c, group, ctx, runId);
      const changes: ChangeRow[] = [];
      for (const p of group) {
        if (!existed.has(p.nct_id)) {
          changes.push({
            trial_id: p.nct_id, change: "added", field: null, old_value: null,
            new_value: snapshot({ ...p.mapped, obesity_class: classify(p.mapped, p.title).class }),
          });
        } else if (beforeOf.has(p.nct_id)) {
          changes.push(...diffMapped(parseAndValidate(beforeOf.get(p.nct_id)!).value, p.mapped));
        }
      }
      await insertChanges(c, changes, runId);
    });
  if (changed.length) {
    try {
      await write(changed);
      res.upserted += changed.length;
      succeeded.push(...changed.map((p) => p.nct_id));
    } catch {
      for (const p of changed) {
        try {
          await write([p]);
          res.upserted += 1;
          succeeded.push(p.nct_id);
        } catch (err) {
          await fail(state, p.nct_id, "map_or_upsert", err);
        }
      }
    }
  }

  for (const id of succeeded) state.touched.add(id);
  // Records that failed before and are fine now leave the retry / dead-letter queue.
  const healed = succeeded.filter((id) => state.openFailures.has(id));
  if (healed.length) {
    await resolveFailures(healed, "ingested successfully on a later attempt");
    for (const id of healed) state.openFailures.delete(id);
  }
}

/**
 * Core sync loop, shared by the live network sync and by tests.
 * `source` yields raw study payloads; `getPages` reports page progress.
 */
async function runSyncCore(
  source: AsyncIterable<RawStudy>,
  getPages: () => number = () => 0,
  mode = "incremental",
  onProgress?: (res: Counts) => void,
): Promise<SyncResult & { touched: Set<string> }> {
  const started = Date.now();
  const ctx = await loadProductContext();
  const runId = await startRun(mode);
  const state: RunState = {
    ctx, runId,
    res: { fetched: 0, upserted: 0, unchanged: 0, filtered: 0, failed: 0, pages: 0 },
    errors: [],
    openFailures: await openFailureIds(),
    touched: new Set(),
  };
  const res = state.res;

  try {
    let buf: RawStudy[] = [];
    for await (const raw of source) {
      res.fetched += 1;
      buf.push(raw);
      if (buf.length >= BATCH_SIZE) {
        res.pages = getPages();
        await ingestBatch(buf, state);
        buf = [];
        onProgress?.(res);
      }
    }
    if (buf.length) await ingestBatch(buf, state);
    res.pages = getPages();
    await finishRun(runId, res, started, state.errors);
  } catch (err) {
    await finishRun(runId, res, started, state.errors, err instanceof Error ? err.message : String(err));
    throw err;
  }
  return { runId, ...res, durationMs: Date.now() - started, touched: state.touched };
}

function progressLogger(label: string) {
  let lastLog = 0;
  return (r: Counts) => {
    if (Date.now() - lastLog < 15_000) return; // progress line every ~15 s (visible in the GitHub log)
    lastLog = Date.now();
    console.log(`  … ${label}: ${r.fetched} fetched · ${r.upserted} written · ${r.unchanged} unchanged · ` +
      `${r.filtered} not primary obesity · ${r.failed} failed`);
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
  const { touched: _touched, ...result } = await runSyncCore(
    source, () => pageCount, full ? "full" : "incremental", progressLogger(full ? "full" : "incremental"),
  );
  if (full) {
    // Trials CT.gov no longer returns for our scope (withdrawn from the search,
    // or the scope was narrowed) are removed — only after a clean, complete run.
    if (result.failed === 0 && result.fetched > 0) {
      const p = await pruneNotSeen(result.runId);
      if (p.removed) console.log(`  removed ${p.removed} stored trial(s) no longer returned by CT.gov for this scope`);
      if (p.skipped) {
        console.warn(`  NOT removing ${p.skipped} trial(s) that CT.gov did not return: that is more than the safety ` +
          `limit. If this is expected (scope changed), re-run with SYNC_ALLOW_LARGE_PRUNE=true.`);
      }
    } else {
      console.log("  some records failed — skipped removing trials that were not returned this time");
    }
    // A full backfill re-derives every product link with the corpus-wide known set.
    await rebuildProducts();
    const now = new Date().toISOString();
    await setMeta("full_sync_at", now);              // the first full load is complete
    await setMeta("keeps_non_primary_since", now);   // non-primary trials are stored (Phase 2)
    await setMeta("fetch_scope", fetchScopeKey());   // which CT.gov search this full load covered
  }
  return result;
}

// --------------------------------------------------------------------------- #
// Retry queue
// --------------------------------------------------------------------------- #
export interface RetryResult {
  due: number;
  retried: number;
  resolved: number;
  stillFailing: number;
  notReturned: number;
}

/**
 * Re-fetch the trials in the retry queue whose next attempt is due (by NCT ID)
 * and ingest them again. Trials CT.gov no longer returns for our scope are
 * resolved ("not returned").
 */
export async function retryFailures(fetchIds?: (ids: string[]) => AsyncIterable<RawStudy>): Promise<RetryResult> {
  const due = await dueFailures();
  const out: RetryResult = { due: due.length, retried: 0, resolved: 0, stillFailing: 0, notReturned: 0 };
  if (!due.length) return out;
  const fetcher = fetchIds ?? ((ids: string[]) => (async function* () {
    for (const group of chunks(ids, 100)) {
      yield* iterateStudies({ incrementalDays: null, startDateFrom: config.ctgov.startDateFrom || null, ids: group });
    }
  })());
  // Remember which records CT.gov actually sent back.
  const returned = new Set<string>();
  async function* tracked() {
    for await (const s of fetcher(due)) {
      const id = s?.protocolSection?.identificationModule?.nctId;
      if (id) returned.add(String(id).toUpperCase());
      yield s;
    }
  }
  const r = await runSyncCore(tracked(), () => 0, "retry");
  out.retried = returned.size;
  out.stillFailing = r.failed;
  // Not sent back at all: the trial left our search scope (or was withdrawn).
  out.notReturned = await resolveFailures(
    due.filter((id) => !returned.has(id)),
    "not returned by CT.gov for the current scope",
  );
  out.resolved = due.filter((id) => r.touched.has(id)).length;
  return out;
}

// --------------------------------------------------------------------------- #
// Re-parse from raw_trials (no network)
// --------------------------------------------------------------------------- #
export interface ReparseResult {
  runId: string;
  scanned: number;
  reparsed: number;
  filtered: number;   // not primary obesity (kept, labelled)
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
  const write = (group: { id: string; input: TrialInput }[]) =>
    withTransaction(async (c) => {
      await writeTrialsBatch(c, group.map((g) => g.input), ctx, runId);
      await c.query("UPDATE raw_trials SET parser_version = $2 WHERE source = $1 AND source_id = ANY($3)",
        [SOURCE, PARSER_VERSION, group.map((g) => g.id)]);
    });
  for (const batch of chunks(rows.rows, BATCH_SIZE)) {
    const group: { id: string; input: TrialInput }[] = [];
    for (const r of batch) {
      try {
        const v = parseAndValidate(r.payload);
        if (v.errors.length) throw new Error(v.errors.join(" "));
        const title = studyTitle(r.payload);
        if (classify(v.value, title).class !== "primary") out.filtered += 1;
        group.push({ id: r.source_id, input: { mapped: v.value, warnings: v.warnings, title } });
      } catch (err) {
        out.failed += 1;
        errors.push({ nct_id: r.source_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!group.length) continue;
    try {
      await write(group);
      out.reparsed += group.length;
    } catch {
      for (const g of group) {
        try {
          await write([g]);
          out.reparsed += 1;
        } catch (err) {
          out.failed += 1;
          errors.push({ nct_id: g.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }
  await finishRun(runId, { fetched: out.scanned, upserted: out.reparsed, unchanged: 0, filtered: out.filtered,
    failed: out.failed, pages: 0 }, started, errors);
  if (out.reparsed) await rebuildProducts();
  return out;
}

export async function getMeta(key: string): Promise<string | null> {
  const r = await pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}
export async function setMeta(key: string, value: string): Promise<void> {
  await pool.query(
    "INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}

/**
 * Safety limit for removing trials after a full download: at most this many, or
 * this share of the stored trials, unless SYNC_ALLOW_LARGE_PRUNE=true. Protects
 * against a broken or truncated CT.gov response wiping the database.
 */
const PRUNE_LIMIT = { min: 50, share: 0.2 };

/**
 * After a complete full download: delete stored trials (and raw records) that
 * were not seen in that run. Every trial the run returned had its last_seen_at
 * set during the run, so anything older than the run's start was not returned.
 */
export async function pruneNotSeen(runId: string): Promise<{ removed: number; skipped: number }> {
  return withTransaction(async (c) => {
    const start = await c.query<{ run_at: Date }>("SELECT run_at FROM sync_runs WHERE id = $1", [runId]);
    const runAt = start.rows[0]?.run_at;
    if (!runAt) return { removed: 0, skipped: 0 };
    const stale = await c.query<{ nct_id: string }>("SELECT nct_id FROM trials WHERE last_seen_at < $1", [runAt]);
    const ids = stale.rows.map((r) => r.nct_id);
    const total = (await c.query<{ c: number }>("SELECT count(*)::int AS c FROM trials")).rows[0].c;
    const limit = Math.max(PRUNE_LIMIT.min, Math.floor(total * PRUNE_LIMIT.share));
    if (ids.length > limit && process.env.SYNC_ALLOW_LARGE_PRUNE !== "true") {
      await c.query(
        "INSERT INTO app_meta (key, value) VALUES ('prune_skipped', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [JSON.stringify({ at: new Date().toISOString(), count: ids.length, limit })],
      );
      return { removed: 0, skipped: ids.length };
    }
    await c.query("DELETE FROM app_meta WHERE key = 'prune_skipped'");
    const removed = await deleteTrials(c, ids, runId);
    await c.query("DELETE FROM raw_trials WHERE source = $1 AND last_seen_at < $2", [SOURCE, runAt]);
    return { removed, skipped: 0 };
  });
}

/** The CT.gov search a full download covers. A change triggers one full sync. */
export function fetchScopeKey(): string {
  return JSON.stringify({
    condition: config.ctgov.condition,
    interventionTypes: [...config.ctgov.interventionTypes].sort(),
    startDateFrom: config.ctgov.startDateFrom || null,
    statuses: [...config.ctgov.statuses].sort(),
  });
}

/**
 * Has a full download ever completed? (Databases from before this check count as
 * complete if they had a successful full run or the one-off lineage backfill.)
 */
async function fullLoadCompleted(): Promise<boolean> {
  if ((await getMeta("full_sync_at")) || (await getMeta("lineage_backfill_at"))) return true;
  const r = await pool.query(
    "SELECT 1 FROM sync_runs WHERE (mode = 'full' OR mode IS NULL) AND status IN ('success','partial') LIMIT 1",
  );
  return (r.rowCount ?? 0) > 0;
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
 *   - first full load cut off      -> finish it
 *   - trials with no lineage yet   -> full backfill (databases upgraded from v1)
 *   - non-primary trials were deleted by an older version -> one full sync brings
 *     them back (they are now kept and labelled)
 *   - raw parsed by an old parser  -> re-parse from raw_trials (no network)
 *   - classifier rules changed     -> re-classify stored trials (no network)
 *   - product rules changed        -> re-parse raw records + rebuild product links
 */
export async function upgradeIfNeeded(log: (msg: string, obj?: unknown) => void): Promise<boolean> {
  if ((await trialCount()) === 0) {
    log("database empty — running full backfill");
    log("backfill complete", await runSync(true));
    return true;
  }
  // A first full load that was cut off (e.g. a job time limit) leaves a partly
  // filled database: finish it before switching to daily updates.
  if (!(await fullLoadCompleted())) {
    log("the first full download never finished — running it now (already-stored trials are skipped)");
    log("full download complete", await runSync(true));
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
  if ((await getMeta("fetch_scope")) !== fetchScopeKey()) {
    log("the CT.gov search changed (wider terms / intervention types) — full sync to pick up the extra trials", JSON.parse(fetchScopeKey()));
    log("full sync complete", await runSync(true));
    log("classification", await reclassifyAll());
    return true;
  }
  if (!(await getMeta("keeps_non_primary_since"))) {
    log("older versions deleted non-primary-obesity trials — one full sync to store and label them");
    log("full sync complete", await runSync(true));
    log("classification", await reclassifyAll());
    return true;
  }
  const stale = await rawNeedingReparse();
  if (stale > 0) {
    log(`${stale} raw record(s) parsed by an older parser — re-parsing (no download)`);
    log("re-parse complete", await reparseFromRaw());
  }
  if ((await getMeta("obesity_classifier_version")) !== CLASSIFIER_VERSION) {
    log(`classification rules changed (${CLASSIFIER_VERSION}) — re-classifying stored trials`, await reclassifyAll());
  }
  if (await productsNeedRebuild()) {
    // New drug-matching rules: re-parse every stored raw record (not just the stored
    // drug names — names that matched no drug before were not kept), then rebuild.
    const r = await reparseFromRaw({ all: true });
    log("drug-matching rules changed — re-parsed stored records and rebuilt drugs", r);
    if (!r.reparsed) log("products rebuilt", await rebuildProducts());
  }
  return false;
}

/** Recompute trial_quality for every stored trial from its raw record (no network). */
export async function refreshQuality(context?: ProductContext): Promise<number> {
  const ctx = context ?? (await loadProductContext());
  const rows = await pool.query<{ payload: RawStudy }>(
    `SELECT r.payload FROM raw_trials r JOIN trials t ON t.nct_id = r.source_id WHERE r.source = $1`,
    [SOURCE],
  );
  const items: QualityInput[] = rows.rows.map((r) => {
    const v = parseAndValidate(r.payload);
    const { kept, products } = deriveTrialProducts(v.value.interventions, ctx.aliases, ctx.known);
    return { mapped: v.value, kept, productCount: products.length, warnings: v.warnings, undisclosedOnly: undisclosedOnly(products) };
  });
  await withTransaction(async (c) => {
    for (const group of chunks(items, 1000)) await writeQualityBatch(c, group);
  });
  return items.length;
}

/**
 * Whole days since the last successful/partial sync run, or null if there has
 * never been one. Used by the scheduler to size a catch-up window.
 */
export async function daysSinceLastSuccessfulSync(): Promise<number | null> {
  const r = await pool.query<{ last: Date | null }>(
    "SELECT max(run_at) AS last FROM sync_runs WHERE status IN ('success','partial') AND mode IS DISTINCT FROM 'retry'",
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
  const { touched: _t, ...r } = await runSyncCore(gen(), () => 1, "test");
  return r;
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
    for (const group of chunks([...perTrial.entries()], 2000)) {
      await c.query(
        `UPDATE trials t SET interventions = x.kept
           FROM jsonb_to_recordset($1::jsonb) AS x(nct_id text, kept text[])
          WHERE t.nct_id = x.nct_id AND t.interventions IS DISTINCT FROM x.kept`,
        [JSON.stringify(group.map(([nct_id, d]) => ({ nct_id, kept: d.kept })))],
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
// Obesity classification (no network)
// --------------------------------------------------------------------------- #
export interface ClassificationSummary {
  version: string;
  trials: number;
  changed: number;            // class, reason or terms changed
  reclassified: number;       // class changed
  counts: Record<string, number>;
}

/**
 * Re-classify every stored trial from its stored conditions with the current
 * rules (CLASSIFIER_VERSION). Class changes are written to the change history.
 */
export async function reclassifyAll(runId: string | null = null): Promise<ClassificationSummary> {
  const rows = await pool.query<{
    nct_id: string; conditions: string[] | null; lead_sponsor_class: string | null; title: string | null;
    obesity_class: string; obesity_reason: string | null; obesity_terms: string[]; classifier_version: string | null;
  }>(
    `SELECT t.nct_id, t.conditions, t.lead_sponsor_class,
            r.payload #>> '{protocolSection,identificationModule,briefTitle}' AS title,
            t.obesity_class, t.obesity_reason, t.obesity_terms, t.classifier_version
       FROM trials t LEFT JOIN raw_trials r ON r.source = $1 AND r.source_id = t.nct_id`,
    [SOURCE],
  );
  const counts: Record<string, number> = { primary: 0, comorbidity: 0, weight_related: 0, unrelated: 0 };
  const updates: { nct_id: string; cls: string; reason: string; terms: string[] }[] = [];
  const changes: ChangeRow[] = [];
  for (const r of rows.rows) {
    const c = classifyObesity(r.conditions ?? [], r.lead_sponsor_class, r.title);
    counts[c.class] = (counts[c.class] ?? 0) + 1;
    const differs = c.class !== r.obesity_class || c.reason !== r.obesity_reason ||
      JSON.stringify(c.terms) !== JSON.stringify(r.obesity_terms ?? []) || r.classifier_version !== CLASSIFIER_VERSION;
    if (!differs) continue;
    updates.push({ nct_id: r.nct_id, cls: c.class, reason: c.reason, terms: c.terms });
    if (c.class !== r.obesity_class) {
      changes.push({ trial_id: r.nct_id, change: "reclassified", field: "obesity_class", old_value: r.obesity_class, new_value: c.class });
    }
  }
  await withTransaction(async (c) => {
    for (const group of chunks(updates, 2000)) {
      await c.query(
        `UPDATE trials t SET obesity_class = x.cls, obesity_reason = x.reason, obesity_terms = x.terms,
                classifier_version = $2
           FROM jsonb_to_recordset($1::jsonb) AS x(nct_id text, cls text, reason text, terms text[])
          WHERE t.nct_id = x.nct_id`,
        [JSON.stringify(group), CLASSIFIER_VERSION],
      );
    }
    await insertChanges(c, changes, runId);
    await c.query(
      `INSERT INTO app_meta (key, value) VALUES ('obesity_classifier_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CLASSIFIER_VERSION],
    );
  });
  return { version: CLASSIFIER_VERSION, trials: rows.rowCount ?? 0, changed: updates.length, reclassified: changes.length, counts };
}

/** Stored trials per obesity class. */
export async function classificationCounts(): Promise<Record<string, number>> {
  const r = await pool.query<{ obesity_class: string; c: number }>(
    "SELECT obesity_class, count(*)::int AS c FROM trials GROUP BY obesity_class",
  );
  return Object.fromEntries(r.rows.map((x) => [x.obesity_class, x.c]));
}
