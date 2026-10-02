import { test } from "node:test";
import assert from "node:assert/strict";
import { mapStudy, trimPayload, contentHash, canonicalJson, PARSER_VERSION } from "./mapper.js";
import { productsFromName, deriveTrialProducts } from "./products.js";
import { runSyncForStudies, rebuildProducts, reparseFromRaw, trialsMissingLineage } from "./sync.js";
import { assessQuality } from "./quality.js";
import { isObesityIndication } from "./obesity-filter.js";
import { pool, pgConfig } from "./db.js";

// A realistic (trimmed) CT.gov v2 study payload.
function study(
  nct: string,
  over: { conditions?: string[]; interventions?: any[]; countries?: string[]; phase?: string[]; updated?: string; sponsor?: string | null } = {},
) {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, briefTitle: "ignored" },
      statusModule: { overallStatus: "RECRUITING", lastUpdatePostDateStruct: { date: over.updated ?? "2026-09-15", type: "ACTUAL" } },
      sponsorCollaboratorsModule: {
        leadSponsor: over.sponsor === null ? undefined : { name: over.sponsor ?? "Test Pharma Inc.", class: "INDUSTRY" },
      },
      conditionsModule: { conditions: over.conditions ?? ["Obesity", "Overweight"] },
      designModule: { phases: over.phase ?? ["PHASE3"], enrollmentInfo: { count: 400 } },
      armsInterventionsModule: {
        interventions: over.interventions ?? [
          { type: "DRUG", name: "Semaglutide 2.4 mg" },
          { type: "DRUG", name: "Placebo" },
          { type: "BEHAVIORAL", name: "Diet and exercise" },
        ],
      },
      contactsLocationsModule: {
        locations: (over.countries ?? ["United States", "Germany", "United States"]).map((c) => ({
          facility: "Site", city: "City", country: c,
        })),
      },
    },
  };
}

test("mapStudy keeps only the lean fields", () => {
  const m = mapStudy(study("NCT99999001"));
  assert.deepEqual(Object.keys(m).sort(), [
    "conditions", "countries", "interventions", "lead_sponsor_class", "nct_id", "phase", "source_updated_at", "sponsor",
  ]);
  assert.equal(m.source_updated_at, "2026-09-15");
  assert.equal(m.phase, "PHASE3");
  assert.equal(m.sponsor, "Test Pharma Inc.");
  assert.deepEqual(m.conditions, ["Obesity", "Overweight"]);
  assert.deepEqual(m.interventions, ["Semaglutide 2.4 mg", "Placebo"]); // behavioural dropped
  assert.deepEqual(m.countries, ["Germany", "United States"]);          // distinct, sorted
});

test("product normalization", () => {
  const names = (n: string) => productsFromName(n).map((p) => p.name);
  assert.deepEqual(names("Semaglutide 2.4 mg"), ["Semaglutide"]);
  assert.deepEqual(names("Semaglutide (Wegovy) weekly injection"), ["Semaglutide"]);
  assert.deepEqual(names("Wegovy"), ["Semaglutide"]);
  assert.deepEqual(names("Placebo (semaglutide)"), []);
  assert.deepEqual(names("LY3502970"), ["Orforglipron"]);
  assert.deepEqual(names("BI 456906"), ["Survodutide"]);
  assert.deepEqual(names("HRS-9531 Tablet").map((n) => n.replace("-", "")), ["HRS9531"]);
  assert.deepEqual(names("Phentermine-Topiramate"), ["Phentermine + Topiramate"]);
  assert.deepEqual(names("Qsymia"), ["Phentermine + Topiramate"]);
  assert.deepEqual(names("aleniglipron or placebo"), ["Aleniglipron"]);
  assert.deepEqual(names("Semaglutide or Tirzepatide"), ["Semaglutide", "Tirzepatide"]);
  assert.deepEqual(names("Naltrexone SR 32 mg/bupropion SR 360 mg/day"), ["Bupropion + Naltrexone"]);
  assert.deepEqual(names("GLP-1 receptor agonist"), []);
  assert.deepEqual(names("Glucagon"), ["Glucagon"]);
  const d = deriveTrialProducts(["Tirzepatide", "Placebo", "tirzepatide injection"]);
  assert.deepEqual(d.kept, ["Tirzepatide", "tirzepatide injection"]);
  assert.deepEqual(d.products.map((p) => p.slug), ["tirzepatide"]);
});

test("obesity filter", () => {
  assert.equal(isObesityIndication(["Obesity"]), true);
  assert.equal(isObesityIndication(["Type 2 Diabetes", "Obesity-related hypertension"]), false);
});

test("sync: lean upsert, product links, manual info preserved, non-obesity removed", async () => {
  const A = "NCT99999001";
  const B = "NCT99999002";
  await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [[A, B]]);

  // First run inserts both trials and links them to Semaglutide.
  const r1 = await runSyncForStudies([
    study(A),
    study(B, { interventions: [{ type: "DRUG", name: "Wegovy" }], countries: ["Japan"] }),
  ]);
  assert.equal(r1.upserted, 2);

  const t = await pool.query(
    "SELECT phase, sponsor, conditions, interventions, countries, continents FROM trials WHERE nct_id=$1", [A]);
  assert.equal(t.rows[0].phase, "PHASE3");
  assert.deepEqual(t.rows[0].interventions, ["Semaglutide 2.4 mg"]); // placebo not stored
  assert.deepEqual(t.rows[0].countries, ["Germany", "United States"]);
  assert.deepEqual(t.rows[0].continents, ["Europe", "North America"]);

  const linked = await pool.query(
    `SELECT tp.nct_id FROM trial_products tp JOIN products p ON p.id = tp.product_id
      WHERE p.slug = 'semaglutide' AND tp.nct_id = ANY($1) ORDER BY 1`, [[A, B]]);
  assert.deepEqual(linked.rows.map((r) => r.nct_id), [A, B]);

  // Product info starts blank; fill it in manually.
  const blank = await pool.query("SELECT modality, phase, moa, roa, approved, approval_date, sponsor, drug_class FROM products WHERE slug='semaglutide'");
  assert.ok(Object.values(blank.rows[0]).every((v) => v === null));
  await pool.query("UPDATE products SET modality='Peptide', moa='GLP-1 receptor agonist', approved='Yes', approval_date='2021-06-04' WHERE slug='semaglutide'");

  // Same payload again: unchanged.
  const r2 = await runSyncForStudies([study(A)]);
  assert.equal(r2.unchanged, 1);

  // Changed payload: upserted; manual info still there.
  const r3 = await runSyncForStudies([study(A, { phase: ["PHASE4"] })]);
  assert.equal(r3.upserted, 1);
  await rebuildProducts();
  const info = await pool.query("SELECT modality, moa, approved, to_char(approval_date,'YYYY-MM-DD') d FROM products WHERE slug='semaglutide'");
  assert.deepEqual(info.rows[0], { modality: "Peptide", moa: "GLP-1 receptor agonist", approved: "Yes", d: "2021-06-04" });

  // A trial whose conditions change to non-primary-obesity is removed.
  const r4 = await runSyncForStudies([study(B, { conditions: ["Type 2 Diabetes"] })]);
  assert.equal(r4.filtered, 1);
  const gone = await pool.query("SELECT count(*)::int c FROM trials WHERE nct_id=$1", [B]);
  assert.equal(gone.rows[0].c, 0);

  await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [[A, B]]);
  await pool.query("UPDATE products SET modality=NULL, moa=NULL, approved=NULL, approval_date=NULL WHERE slug='semaglutide'");
});

test("product_aliases merges are applied by the sync", async () => {
  const C = "NCT99999003";
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [C]);
  await pool.query(
    `INSERT INTO product_aliases (alias_slug, product_slug, product_name) VALUES ('semagludtide', 'semaglutide', 'Semaglutide')
     ON CONFLICT (alias_slug) DO UPDATE SET product_slug = EXCLUDED.product_slug`,
  );
  await runSyncForStudies([study(C, { interventions: [{ type: "DRUG", name: "Semagludtide 1 mg" }] })]);
  const r = await pool.query(
    `SELECT p.slug FROM trial_products tp JOIN products p ON p.id = tp.product_id WHERE tp.nct_id = $1`, [C]);
  assert.deepEqual(r.rows.map((x) => x.slug), ["semaglutide"]);
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [C]);
  await pool.query("DELETE FROM product_aliases WHERE alias_slug = 'semagludtide'");
});

// --------------------------------------------------------------------------- #
// Priority 1: lineage, hashing, parser version, quality, migrations
// --------------------------------------------------------------------------- #
test("content hash is stable: key order and full vs fields-limited payload", () => {
  const full = study("NCT99999010");
  const trimmed = trimPayload(full);
  // Fields we do not ingest are dropped...
  assert.equal((trimmed as any).protocolSection.identificationModule.briefTitle, undefined);
  assert.equal((trimmed as any).protocolSection.statusModule.overallStatus, undefined);
  // ...and the trimmed copy maps to exactly the same trial (re-parse parity).
  assert.deepEqual(mapStudy(trimmed), mapStudy(full));
  // A re-ordered object hashes identically.
  const reverseKeys = (v: any): any =>
    Array.isArray(v) ? v.map(reverseKeys)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])]))
      : v;
  const reordered = reverseKeys(full);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(full)); // really re-ordered
  assert.equal(contentHash(trimPayload(reordered)), contentHash(trimmed));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  // A real change changes the hash.
  assert.notEqual(contentHash(trimPayload(study("NCT99999010", { phase: ["PHASE2"] }))), contentHash(trimmed));
});

test("quality checks", () => {
  const good = mapStudy(study("NCT99999011"));
  const q1 = assessQuality(good, ["Semaglutide 2.4 mg"], 1, ["Europe", "North America"]);
  assert.equal(q1.score, 1);
  assert.deepEqual(q1.issues, []);

  const bad = mapStudy(study("NCT99999012", { sponsor: null, countries: [], phase: [], interventions: [{ type: "DRUG", name: "Wonderpill XR" }] }));
  const q2 = assessQuality(bad, [], 0, []);
  const codes = q2.issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ["MISSING_PHASE", "MISSING_SPONSOR", "NO_DRUG_PRODUCT", "NO_LOCATION"]);
  assert.equal(q2.error_count, 1);
  assert.equal(q2.warning_count, 3);
  assert.ok(q2.score < 0.5);

  const q3 = assessQuality(good, ["Semaglutide 2.4 mg"], 1, ["Other"], ["Atlantis"]);
  assert.deepEqual(q3.issues.map((i) => [i.code, i.detail]), [["UNKNOWN_COUNTRY", ["Atlantis"]]]);
});

test("lineage: raw_trials, trial_sources, timestamps, parser version, change detection", async () => {
  const id = "NCT99999020";
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [id]);
  await pool.query("DELETE FROM raw_trials WHERE source_id = $1", [id]);

  const r1 = await runSyncForStudies([study(id)]);
  assert.equal(r1.upserted, 1);
  const raw1 = (await pool.query("SELECT * FROM raw_trials WHERE source='CTGOV' AND source_id=$1", [id])).rows[0];
  assert.equal(raw1.parser_version, PARSER_VERSION);
  assert.equal(raw1.content_hash, contentHash(trimPayload(study(id))));
  assert.equal(raw1.payload.protocolSection.identificationModule.nctId, id);
  assert.equal(raw1.payload.protocolSection.identificationModule.briefTitle, undefined); // trimmed
  const src = (await pool.query("SELECT * FROM trial_sources WHERE source='CTGOV' AND source_id=$1", [id])).rows[0];
  assert.equal(src.trial_id, id);
  assert.equal(src.source_url, `https://clinicaltrials.gov/study/${id}`);
  const t1 = (await pool.query(
    "SELECT version, to_char(source_updated_at,'YYYY-MM-DD') su, parser_version, record_hash, first_seen_at, last_seen_at, last_changed_at, last_run_id FROM trials WHERE nct_id=$1", [id])).rows[0];
  assert.equal(t1.version, 1);
  assert.equal(t1.su, "2026-09-15");
  assert.equal(t1.parser_version, PARSER_VERSION);
  assert.equal(t1.last_run_id, r1.runId);
  const q = (await pool.query("SELECT score FROM trial_quality WHERE trial_id=$1", [id])).rows[0];
  assert.ok(Number(q.score) > 0.9);

  // Same payload: unchanged; last_seen_at moves, last_changed_at and version do not.
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await runSyncForStudies([study(id)]);
  assert.equal(r2.unchanged, 1);
  const t2 = (await pool.query("SELECT version, last_seen_at, last_changed_at FROM trials WHERE nct_id=$1", [id])).rows[0];
  assert.equal(t2.version, 1);
  assert.ok(t2.last_seen_at > t1.last_seen_at);
  assert.equal(t2.last_changed_at.getTime(), t1.last_changed_at.getTime());

  // Raw-only change (an extra site in a country already listed): raw hash changes,
  // the lean trial record does not -> no version bump.
  const r3 = await runSyncForStudies([study(id, { countries: ["United States", "Germany", "United States", "Germany"] })]);
  assert.equal(r3.upserted, 1);
  const raw3 = (await pool.query("SELECT content_hash, last_changed_at FROM raw_trials WHERE source_id=$1", [id])).rows[0];
  assert.notEqual(raw3.content_hash, raw1.content_hash);
  assert.equal((await pool.query("SELECT version FROM trials WHERE nct_id=$1", [id])).rows[0].version, 1);

  // Real change: version bumps, last_changed_at and last_run_id move.
  const r4 = await runSyncForStudies([study(id, { phase: ["PHASE4"], updated: "2026-10-01" })]);
  const t4 = (await pool.query(
    "SELECT version, phase, to_char(source_updated_at,'YYYY-MM-DD') su, last_changed_at, last_run_id FROM trials WHERE nct_id=$1", [id])).rows[0];
  assert.equal(t4.version, 2);
  assert.equal(t4.phase, "PHASE4");
  assert.equal(t4.su, "2026-10-01");
  assert.ok(t4.last_changed_at > t1.last_changed_at);
  assert.equal(t4.last_run_id, r4.runId);

  // Run log records mode / parser / counts.
  const run = (await pool.query("SELECT mode, parser_version, trials_upserted, trials_unchanged FROM sync_runs WHERE id=$1", [r2.runId])).rows[0];
  assert.deepEqual(run, { mode: "test", parser_version: PARSER_VERSION, trials_upserted: 0, trials_unchanged: 1 });

  // Out of scope now -> trial AND raw record removed.
  await runSyncForStudies([study(id, { conditions: ["Type 2 Diabetes"] })]);
  assert.equal((await pool.query("SELECT count(*)::int c FROM raw_trials WHERE source_id=$1", [id])).rows[0].c, 0);
  assert.equal((await pool.query("SELECT count(*)::int c FROM trial_sources WHERE source_id=$1", [id])).rows[0].c, 0);
});

test("batched sync: many trials, duplicates, mixed new / unchanged / filtered", async () => {
  const ids = Array.from({ length: 600 }, (_, i) => `NCT9988${String(i).padStart(4, "0")}`);
  await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM raw_trials WHERE source_id = ANY($1)", [ids]);
  const drugs = ["Semaglutide 2.4 mg", "Tirzepatide", "Orforglipron", "Retatrutide"];
  const mk = (id: string, i: number, over: any = {}) =>
    study(id, { interventions: [{ type: "DRUG", name: drugs[i % 4] }, { type: "DRUG", name: "Placebo" }], ...over });

  // 600 trials (crosses the batch size) + a duplicate of the first one.
  const r1 = await runSyncForStudies([...ids.map((id, i) => mk(id, i)), mk(ids[0], 0)]);
  assert.equal(r1.failed, 0);
  assert.equal(r1.upserted, 600);
  const c = (await pool.query(
    `SELECT (SELECT count(*)::int FROM trials WHERE nct_id = ANY($1)) t,
            (SELECT count(*)::int FROM raw_trials WHERE source_id = ANY($1)) r,
            (SELECT count(*)::int FROM trial_sources WHERE source_id = ANY($1)) s,
            (SELECT count(*)::int FROM trial_quality WHERE trial_id = ANY($1)) q,
            (SELECT count(*)::int FROM trial_products WHERE nct_id = ANY($1)) tp`, [ids])).rows[0];
  assert.deepEqual(c, { t: 600, r: 600, s: 600, q: 600, tp: 600 });
  const sema = (await pool.query(
    `SELECT count(*)::int c FROM trial_products tp JOIN products p ON p.id = tp.product_id
      WHERE p.slug = 'semaglutide' AND tp.nct_id = ANY($1)`, [ids])).rows[0].c;
  assert.equal(sema, 150);
  assert.deepEqual((await pool.query("SELECT continents FROM trials WHERE nct_id=$1", [ids[5]])).rows[0].continents.sort(),
    ["Europe", "North America"]);

  // Second pass: 1 changed, 1 now out of scope, the rest unchanged.
  const r2 = await runSyncForStudies(ids.map((id, i) =>
    i === 1 ? mk(id, i, { phase: ["PHASE2"] }) : i === 2 ? mk(id, i, { conditions: ["Type 2 Diabetes"] }) : mk(id, i)));
  assert.deepEqual([r2.upserted, r2.filtered, r2.unchanged, r2.failed], [1, 1, 598, 0]);
  assert.equal((await pool.query("SELECT version FROM trials WHERE nct_id=$1", [ids[1]])).rows[0].version, 2);
  assert.equal((await pool.query("SELECT count(*)::int c FROM trials WHERE nct_id=$1", [ids[2]])).rows[0].c, 0);

  await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM raw_trials WHERE source_id = ANY($1)", [ids]);
});

test("re-parse from raw_trials without downloading", async () => {
  const id = "NCT99999030";
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [id]);
  await runSyncForStudies([study(id)]);
  // Simulate an older parser having produced a wrong value.
  await pool.query("UPDATE raw_trials SET parser_version = 'ctgov-old' WHERE source_id = $1", [id]);
  await pool.query("UPDATE trials SET phase = 'WRONG' WHERE nct_id = $1", [id]);
  const r = await reparseFromRaw();
  assert.ok(r.reparsed >= 1);
  const t = (await pool.query("SELECT phase, parser_version FROM trials WHERE nct_id=$1", [id])).rows[0];
  assert.equal(t.phase, "PHASE3");
  assert.equal(t.parser_version, PARSER_VERSION);
  assert.equal((await pool.query("SELECT parser_version FROM raw_trials WHERE source_id=$1", [id])).rows[0].parser_version, PARSER_VERSION);
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [id]);
  await pool.query("DELETE FROM raw_trials WHERE source_id = $1", [id]);
});

test("migrations are tracked; trials without lineage are detected", async () => {
  const m = await pool.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
  assert.ok(m.rowCount! >= 7);
  assert.ok(m.rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum)));
  const id = "NCT99999040";
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [id]);
  const before = await trialsMissingLineage();
  await pool.query("INSERT INTO trials (nct_id, conditions) VALUES ($1, '{Obesity}')", [id]);
  assert.equal(await trialsMissingLineage(), before + 1);
  await pool.query("DELETE FROM trials WHERE nct_id = $1", [id]);
});

test("database connection settings (Supabase SSL handling)", () => {
  const prev = process.env.DATABASE_CA_CERT;
  delete process.env.DATABASE_CA_CERT;
  // Local / Neon: untouched.
  const local = pgConfig("postgres://postgres:postgres@db:5432/obesity_trials");
  assert.equal(local.connectionString, "postgres://postgres:postgres@db:5432/obesity_trials");
  assert.equal(local.ssl, undefined);
  // Supabase pooler: sslmode stripped, encrypted without CA verification.
  const supa = pgConfig("postgresql://postgres.abcd:Pass123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require");
  assert.ok(!supa.connectionString!.includes("sslmode"));
  assert.deepEqual(supa.ssl, { rejectUnauthorized: false });
  // With Supabase's CA certificate: verified.
  process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----";
  const verified = pgConfig("postgresql://u:p@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=require");
  assert.deepEqual(verified.ssl, { ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  if (prev === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = prev;
});

test.after(async () => {
  await pool.end();
});
