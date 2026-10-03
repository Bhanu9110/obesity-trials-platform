// Phase 2 tests: obesity classification, validation, retry / dead-letter queue,
// change history, health checks, safety guards. Needs DATABASE_URL (a test DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyObesity, CLASSIFIER_VERSION } from "./obesity-filter.js";
import { validateMapped, checkStudiesPage } from "./validate.js";
import { mapStudy } from "./mapper.js";
import { MAX_ATTEMPTS, recordFailure, requeueFailure, dismissFailure, failureCounts } from "./failures.js";
import {
  runSyncForStudies, retryFailures, reclassifyAll, pruneNotSeen, rebuildProducts, getMeta, purgeOutOfScope,
} from "./sync.js";
import { checkHealth } from "./health.js";
import { pool } from "./db.js";

function study(
  nct: string,
  over: { conditions?: string[]; drugs?: string[]; countries?: string[]; phase?: string[]; updated?: string; sponsor?: string; cls?: string; title?: string } = {},
) {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, briefTitle: over.title ?? "A study" },
      statusModule: { lastUpdatePostDateStruct: { date: over.updated ?? "2026-09-15" } },
      sponsorCollaboratorsModule: { leadSponsor: { name: over.sponsor ?? "Phase Two University", class: over.cls ?? "OTHER" } },
      conditionsModule: { conditions: over.conditions ?? ["Obesity"] },
      designModule: { phases: over.phase ?? ["PHASE2"] },
      armsInterventionsModule: { interventions: (over.drugs ?? ["Tirzepatide"]).map((name) => ({ type: "DRUG", name })) },
      contactsLocationsModule: { locations: (over.countries ?? ["India"]).map((country) => ({ country })) },
    },
  };
}

async function clean(ids: string[]) {
  await pool.query("DELETE FROM trials WHERE nct_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM raw_trials WHERE source_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM trial_changes WHERE trial_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM sync_failures WHERE nct_id = ANY($1)", [ids]);
}

// --------------------------------------------------------------------------- #
// Classification
// --------------------------------------------------------------------------- #
test("classification: primary / comorbidity / weight_related / unrelated, with reasons", () => {
  const c = (conds: string[]) => classifyObesity(conds).class;
  assert.equal(c(["Obesity"]), "primary");
  assert.equal(c(["Overweight and Obesity"]), "primary");
  assert.equal(c(["Obesity", "Type 2 Diabetes"]), "primary");                 // obesity leads
  assert.equal(c(["Obesity With Comorbidities Such as Hypertension"]), "primary");
  assert.equal(c(["Hypothalamic Obesity"]), "primary");
  assert.equal(c(["Pregestational Obesity (BMI > 27kg/m2)"]), "primary");
  assert.equal(c(["Dyslipidemia"]), "primary");
  assert.equal(c(["Obesity-associated Asthma"]), "comorbidity");
  assert.equal(c(["Type 2 Diabetes Mellitus in Obese"]), "comorbidity");
  assert.equal(c(["Weight Loss"]), "weight_related");
  assert.equal(c(["Chronic Weight Management"]), "weight_related");
  assert.equal(c(["Breast Cancer"]), "unrelated");
  assert.equal(c([]), "unrelated");
  // word-start matching: "adrenal" is not "renal", so obesity stays primary here
  assert.equal(c(["Obesity and adrenal function"]), "primary");

  // 2.1: negated diseases are ignored; several conditions typed into one field are split.
  assert.equal(c(["Non-diabetic Overweight or Obese"]), "primary");                       // NCT06714955
  assert.equal(c(["Healthy Volunteers", "Obesity"]), "primary");                           // generic items skipped
  assert.equal(c(["Obesity without hypertension"]), "primary");
  assert.equal(c(["Non-alcoholic Fatty Liver Disease in Obese Adults"]), "comorbidity");     // NAFLD stays a disease

  const r = classifyObesity(["Obesity-associated Asthma"]);
  assert.match(r.reason, /comorbidity — the lead condition is "Obesity-associated Asthma"/);
  assert.deepEqual(r.terms, ["Obesity-associated Asthma"]);
  assert.ok(CLASSIFIER_VERSION.startsWith("obesity-"));
});

test("classification 2.2: the lead condition decides (review-band cases)", () => {
  const acad = (conds: string[], title?: string) => classifyObesity(conds, "OTHER", title);
  // another disease listed first -> obesity is a comorbidity (real review-band trials)
  assert.equal(acad(["Alzheimer Disease", "Diabetes Mellitus Type 2", "Obesity & Overweight"]).class, "comorbidity"); // NCT07677865
  assert.equal(acad(["Heart Failure With Preserved Ejection Fraction", "Obesity"],
    "GLIDE-HF Registry: Patients With Obesity-Related Heart Failure").class, "comorbidity");                    // NCT07787936
  assert.equal(acad(["Non-arteritic Anterior Ischemic Optic Neuropathy Obesity", "Obesity"],
    "NAION in Non-Diabetic Obese Patients Using GLP-1 RAs").class, "comorbidity");                             // NCT07846956
  assert.equal(acad(["Polycystic Ovarian Syndrome in Adolescent Females", "Obesity (Disorder)"],
    "Effects of GLP-1 Agonist in Neuro-reproductive Function in Obese Adolescent Females").class, "comorbidity"); // NCT07169136
  assert.equal(acad(["Pregnancy", "Obesity", "Preeclampsia"]).class, "comorbidity");                           // NCT02791568
  assert.equal(acad(["Type 2 Diabetes", "Obesity"]).class, "comorbidity");
  const r = acad(["Alzheimer Disease", "Obesity"]);
  assert.match(r.reason, /lead condition is "Alzheimer Disease"/);
  // ...unless the title names obesity as the treated condition
  assert.equal(acad(["Type 2 Diabetes Mellitus ;Obesity,High Triglycerides；TCM"],
    "Chinese Medicine Treatment of Obesity With Type 2 Diabetes, Dyslipidemia").class, "primary");             // NCT01471275
  assert.equal(acad(["Type 1 Diabetes", "Obesity"], "Gut Microbiome in Lean and Overweight Youth With Type 1 Diabetes").class, "comorbidity");
  // genetic obesity syndromes listed first, PK/healthy items and bariatric surgery skipped
  assert.equal(acad(["Bardet-Biedl Syndrome", "Obesity"]).class, "primary");
  assert.equal(acad(["Bariatric Surgery", "Obesity"]).class, "primary");
  assert.equal(acad(["Metabolism and Nutrition Disorder", "Obesity"]).class, "primary");
  assert.equal(acad(["Prader-Willi Syndrome"], "Oxytocin for Social Behaviour in Prader-Willi Syndrome").class, "unrelated");
  assert.equal(acad(["Participants With Obesity and Knee Osteoarthritis"]).class, "primary");
});

test("classification: industry-sponsored trials are not missed", () => {
  const ind = (conds: string[], title?: string, drugs: string[] = []) => classifyObesity(conds, "INDUSTRY", title, drugs);
  const acad = (conds: string[], title?: string) => classifyObesity(conds, "OTHER", title).class;
  // obesity-drug programmes in obesity complications are kept...
  assert.equal(ind(["Obstructive Sleep Apnea", "Obesity"],
    "Tirzepatide in Participants Who Have Obstructive Sleep Apnea and Obesity", ["Tirzepatide"]).class, "primary");
  assert.equal(ind(["Knee Osteoarthritis", "Obesity"],
    "Ecnoglutide Injection in Obese Participants With Knee Osteoarthritis", ["XW003 injection"]).class, "primary");
  assert.equal(ind(["Type 2 Diabetes", "Overweight", "Obesity"],
    "Tirzepatide in Participants With Type 2 Diabetes Who Have Obesity or Are Overweight (SURMOUNT-2)", ["Tirzepatide"]).class, "primary");
  assert.match(ind(["Hypertension"], "A Master Protocol of Orforglipron in Participants With Hypertension and Obesity").reason,
    /Industry obesity-drug trial \(orforglipron\)/);
  // ...but other drugs in obese patients are a comorbidity
  assert.equal(ind(["Atrial Fibrillation", "Obesity"],
    "Oral Anticoagulants Among Obese Patients With Non-Valvular Atrial Fibrillation", ["Apixaban"]).class, "comorbidity");
  assert.equal(ind(["Obstructive Sleep Apnea (OSA) and Obesity"]).class, "comorbidity");          // no title / drug evidence
  assert.equal(acad(["Obstructive Sleep Apnea (OSA) and Obesity"]), "comorbidity");
  // weight-loss / weight-management wording
  assert.equal(ind(["Chronic Weight Management"]).class, "primary");
  assert.equal(acad(["Chronic Weight Management"]), "weight_related");
  assert.notEqual(ind(["Weight Gain"]).class, "primary");            // antipsychotic weight gain is not obesity
  assert.notEqual(ind(["HIV Lipodystrophy", "Waist Circumference", "BMI"], "The Visceral Adiposity Measurement Study").class, "primary");
  assert.notEqual(ind(["Contraceptive Usage", "Metabolic Syndrome", "Body Weight Changes"]).class, "primary");
  // obesity only in the title (healthy-volunteer / DDI studies of obesity drugs)
  assert.equal(ind(["Healthy"], "Safety of XYZ-123 in Healthy Participants and Participants With Obesity").class, "primary");
  assert.equal(ind(["Healthy Participants"],
    "Effect of AZD6234 on Oral Contraceptive PK in Healthy Female Participants Living With Overweight or Obesity").class, "primary");
  assert.equal(ind(["Cardiometabolic Disease"], "SAD/MAD Study of AMG 513 in Participants With Obesity").class, "primary");
  assert.equal(acad(["Healthy"], "Safety of XYZ-123 in Participants With Obesity"), "unrelated");
  // weight loss from wasting diseases is not obesity
  assert.equal(ind(["Cancer Cachexia"], "Treatment of Cancer Related Anorexia and Weight Loss").class, "unrelated");
});

test("sync: industry trials are kept via sponsor and title; others not stored", async () => {
  const a = "NCT88880051", b = "NCT88880052";
  await clean([a, b]);
  await runSyncForStudies([
    study(a, { conditions: ["Healthy"], cls: "INDUSTRY", title: "First-in-human study of ABC-1 in adults with overweight or obesity" }),
    study(b, { conditions: ["Healthy"], cls: "OTHER", title: "First-in-human study of ABC-1 in adults with overweight or obesity" }),
  ]);
  const r = Object.fromEntries((await pool.query("SELECT nct_id, obesity_class FROM trials WHERE nct_id = ANY($1)", [[a, b]])).rows
    .map((x) => [x.nct_id, x.obesity_class]));
  assert.deepEqual(r, { [a]: "primary" });            // the academic one is not stored
  // re-classification from storage uses the stored title too (stays)
  await pool.query("UPDATE trials SET classifier_version = 'old' WHERE nct_id = $1", [a]);
  await reclassifyAll();
  assert.equal((await pool.query("SELECT obesity_class FROM trials WHERE nct_id = $1", [a])).rows[0].obesity_class, "primary");
  await clean([a, b]);
});

test("drug class only -> Undisclosed drug; no drug at all -> not stored", async () => {
  const cls = "NCT88880061", none = "NCT88880062";
  await clean([cls, none]);
  await runSyncForStudies([
    study(cls, { drugs: ["GLP-1 receptor agonist therapy", "Placebo"] }),
    study(none, { drugs: ["Control Group", "Placebo"] }),
  ]);
  const prods = async (id: string) => (await pool.query(
    "SELECT p.slug, p.name FROM trial_products tp JOIN products p ON p.id = tp.product_id WHERE tp.nct_id = $1", [id])).rows;
  assert.deepEqual(await prods(cls), [{ slug: "undisclosedglp1receptoragonist", name: "Undisclosed GLP-1 receptor agonist" }]);
  assert.deepEqual(await prods(none), []);
  assert.equal((await pool.query("SELECT count(*)::int c FROM trials WHERE nct_id = $1", [none])).rows[0].c, 0);
  const q = (await pool.query("SELECT issues FROM trial_quality WHERE trial_id = $1", [cls])).rows[0].issues;
  assert.ok(q.some((i: any) => i.code === "DRUG_CLASS_ONLY"));
  assert.ok(!q.some((i: any) => i.code === "NO_DRUG_PRODUCT"));
  await clean([cls, none]);
});

// --------------------------------------------------------------------------- #
// Validation
// --------------------------------------------------------------------------- #
test("validation: errors stop a record, warnings clean it", () => {
  const today = new Date("2026-10-03T00:00:00Z");
  const base = mapStudy(study("NCT12345678"));
  assert.deepEqual(validateMapped(base, today).errors, []);

  assert.match(validateMapped({ ...base, nct_id: "NCT123" }, today).errors[0], /Invalid NCT ID/);
  assert.match(validateMapped({ ...base, nct_id: "" as any }, today).errors[0], /Missing NCT ID/);

  const v = validateMapped({
    ...base,
    nct_id: " nct12345678 ",
    phase: "PHASE2, PHASE9",
    sponsor: "Acme\u0000  Pharma\n",
    lead_sponsor_class: "MARTIAN",
    conditions: ["Obesity", "obesity", "  ", "x".repeat(400)],
    source_updated_at: "2027-05-01",
  }, today);
  assert.deepEqual(v.errors, []);
  assert.equal(v.value.nct_id, "NCT12345678");
  assert.equal(v.value.phase, "PHASE2");
  assert.equal(v.value.sponsor, "Acme Pharma");
  assert.equal(v.value.lead_sponsor_class, "UNKNOWN");
  assert.equal(v.value.conditions.length, 2);                 // duplicate + blank dropped
  assert.equal(v.value.conditions[1].length, 300);            // shortened
  assert.equal(v.value.source_updated_at, null);              // future date dropped
  assert.equal(v.warnings.length, 4);

  assert.equal(validateMapped({ ...base, source_updated_at: "2026-02-30" }, today).value.source_updated_at, null);
  assert.equal(checkStudiesPage({ studies: [] }), null);
  assert.match(checkStudiesPage({ studies: "nope" })!, /not a list/);
  assert.match(checkStudiesPage(null)!, /not a JSON object/);
});

// --------------------------------------------------------------------------- #
// Retry queue + dead-letter queue
// --------------------------------------------------------------------------- #
test("retry queue: failures are queued once, go dead after max attempts, heal on success", async () => {
  const id = "NCT88880001";
  await clean([id]);

  // A record that fails validation (malformed NCT ID) is not written; it can't be
  // re-fetched, so it goes straight to the dead-letter queue.
  const bad = study("NCT8888001X");
  const r1 = await runSyncForStudies([bad]);
  assert.equal(r1.failed, 1);
  const f1 = (await pool.query("SELECT status, failure_type FROM sync_failures WHERE nct_id = 'NCT8888001X'")).rows[0];
  assert.deepEqual(f1, { status: "dead", failure_type: "validation" }); // not re-fetchable -> dead-letter
  await pool.query("DELETE FROM sync_failures WHERE nct_id = 'NCT8888001X'");

  // A re-fetchable record failing repeatedly: one open entry, then dead.
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(id, "map_or_upsert", `boom ${i}`, null);
  const rows = (await pool.query("SELECT status, retry_count, error_msg FROM sync_failures WHERE nct_id = $1", [id])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "dead");
  assert.equal(rows[0].retry_count, MAX_ATTEMPTS - 1);
  assert.equal(rows[0].error_msg, `boom ${MAX_ATTEMPTS - 1}`);

  // Requeue -> pending and due now; dismiss -> closed.
  assert.equal(await requeueFailure(id), true);
  const p = (await pool.query("SELECT status, retry_count, next_attempt_at <= now() AS due FROM sync_failures WHERE nct_id = $1", [id])).rows[0];
  assert.deepEqual(p, { status: "pending", retry_count: 0, due: true });

  // A successful ingest heals it.
  const r2 = await runSyncForStudies([study(id)]);
  assert.equal(r2.upserted, 1);
  assert.equal((await pool.query("SELECT status FROM sync_failures WHERE nct_id = $1", [id])).rows[0].status, "resolved");

  await recordFailure(id, "map_or_upsert", "again", null);
  assert.equal(await dismissFailure(id), true);
  assert.equal((await pool.query("SELECT count(*)::int c FROM sync_failures WHERE nct_id=$1 AND status IN ('pending','dead')", [id])).rows[0].c, 0);
  await clean([id]);
});

test("retry queue: due records are re-fetched by NCT ID", async () => {
  const ok = "NCT88880011", gone = "NCT88880012", notDue = "NCT88880013";
  await clean([ok, gone, notDue]);
  await recordFailure(ok, "fetch", "timeout", null);
  await recordFailure(gone, "fetch", "timeout", null);
  await recordFailure(notDue, "fetch", "timeout", null);
  await pool.query("UPDATE sync_failures SET next_attempt_at = now() - interval '1 minute' WHERE nct_id = ANY($1)", [[ok, gone]]);

  const asked: string[][] = [];
  const r = await retryFailures((ids) => (async function* () {
    asked.push(ids);
    yield study(ok);           // CT.gov sends back only one of them
  })());
  assert.deepEqual([...asked[0]].sort(), [ok, gone].sort());     // `notDue` is not due yet
  assert.equal(r.resolved, 1);
  assert.equal(r.notReturned, 1);
  const st = Object.fromEntries((await pool.query(
    "SELECT nct_id, status, resolution FROM sync_failures WHERE nct_id = ANY($1)", [[ok, gone, notDue]])).rows
    .map((x) => [x.nct_id, x.status]));
  assert.deepEqual(st, { [ok]: "resolved", [gone]: "resolved", [notDue]: "pending" });
  assert.ok((await failureCounts()).pending >= 1);
  await clean([ok, gone, notDue]);
});

// --------------------------------------------------------------------------- #
// Change history
// --------------------------------------------------------------------------- #
test("change history: added, field updates, reclassified, removed — no noise", async () => {
  const id = "NCT88880021";
  await clean([id]);
  const changes = async () => (await pool.query(
    "SELECT change, field, old_value, new_value FROM trial_changes WHERE trial_id = $1 ORDER BY id", [id])).rows;

  await runSyncForStudies([study(id)]);
  let c = await changes();
  assert.equal(c.length, 1);
  assert.equal(c[0].change, "added");
  assert.deepEqual(c[0].new_value, { phase: "PHASE2", sponsor: "Phase Two University", obesity_class: "primary" });

  // Unchanged record and a product rebuild: no new history.
  await runSyncForStudies([study(id)]);
  await rebuildProducts();
  assert.equal((await changes()).length, 1);

  // Two registry fields change.
  await runSyncForStudies([study(id, { phase: ["PHASE3"], countries: ["India", "Japan"] })]);
  c = await changes();
  assert.deepEqual(c.slice(1).map((x) => [x.change, x.field, x.old_value, x.new_value]), [
    ["updated", "phase", "PHASE2", "PHASE3"],
    ["updated", "countries", ["India"], ["India", "Japan"]],
  ]);

  // Conditions change so that it is no longer primary obesity -> removed (out of scope).
  await runSyncForStudies([study(id, { phase: ["PHASE3"], countries: ["India", "Japan"], conditions: ["Weight Loss"] })]);
  c = await changes();
  assert.equal(c.length, 4);
  assert.equal(c[3].change, "removed");
  assert.equal(c[3].old_value.obesity_class, "primary");
  assert.equal((await pool.query("SELECT count(*)::int c FROM trials WHERE nct_id=$1", [id])).rows[0].c, 0);

  // Back in scope -> added again; then removed by a full sync that no longer returns it.
  await runSyncForStudies([study(id)]);
  await pool.query("UPDATE trials SET last_seen_at = now() - interval '1 day' WHERE nct_id = $1", [id]);
  await pool.query("UPDATE trials SET last_seen_at = now() + interval '1 hour' WHERE nct_id <> $1", [id]);
  await pool.query("UPDATE raw_trials SET last_seen_at = now() + interval '1 hour' WHERE source_id <> $1", [id]);
  const run = await runSyncForStudies([]);
  assert.deepEqual(await pruneNotSeen(run.runId), { removed: 1, skipped: 0 });
  c = await changes();
  assert.equal(c[c.length - 1].change, "removed");
  assert.equal(c[c.length - 2].change, "added");
  await clean([id]);
});

test("re-classification (rule change) removes trials that are no longer primary obesity", async () => {
  const keep = "NCT88880031", gone = "NCT88880032";
  await clean([keep, gone]);
  await runSyncForStudies([study(keep), study(gone)]);
  // Pretend an older classifier stored this comorbidity trial as primary.
  await pool.query("UPDATE trials SET conditions = ARRAY['Obesity-associated Asthma'], classifier_version = 'obesity-1.0' WHERE nct_id = $1", [gone]);
  const s = await reclassifyAll();
  assert.ok(s.removed >= 1);
  assert.equal(s.version, CLASSIFIER_VERSION);
  const left = (await pool.query("SELECT nct_id FROM trials WHERE nct_id = ANY($1)", [[keep, gone]])).rows.map((x) => x.nct_id);
  assert.deepEqual(left, [keep]);
  assert.equal(await getMeta("obesity_classifier_version"), CLASSIFIER_VERSION);
  const ch = (await pool.query("SELECT change FROM trial_changes WHERE trial_id = $1 ORDER BY id", [gone])).rows.map((x) => x.change);
  assert.deepEqual(ch.slice(-1), ["removed"]);
  await clean([keep, gone]);
});

test("one-off clean-up removes stored out-of-scope trials", async () => {
  const ok = "NCT88880071", nodrug = "NCT88880072";
  await clean([ok, nodrug]);
  await runSyncForStudies([study(ok), study(nodrug)]);
  // An older version stored a non-primary trial and a trial whose drug link vanished.
  await pool.query("DELETE FROM trial_products WHERE nct_id = $1", [nodrug]);
  const extra = "NCT88880073";
  await pool.query(`INSERT INTO trials (nct_id, conditions, is_active, obesity_class) VALUES ($1, ARRAY['Breast Cancer'], true, 'unrelated')`, [extra]);
  const removed = await purgeOutOfScope();
  assert.ok(removed >= 2);
  const left = (await pool.query("SELECT nct_id FROM trials WHERE nct_id = ANY($1)", [[ok, nodrug, extra]])).rows.map((x) => x.nct_id);
  assert.deepEqual(left, [ok]);
  await clean([ok, nodrug, extra]);
});

// --------------------------------------------------------------------------- #
// Safety guards + health
// --------------------------------------------------------------------------- #
test("removal guard: a full sync that suddenly misses many trials removes nothing", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `NCT8889${String(i).padStart(4, "0")}`);
  await clean(ids);
  await runSyncForStudies(ids.map((id) => study(id)));
  await pool.query("UPDATE trials SET last_seen_at = now() - interval '1 day' WHERE nct_id = ANY($1)", [ids]);
  await pool.query("UPDATE trials SET last_seen_at = now() + interval '1 hour' WHERE nct_id <> ALL($1)", [ids]);
  const run = await runSyncForStudies([]);
  const p = await pruneNotSeen(run.runId);
  assert.deepEqual(p, { removed: 0, skipped: 60 });
  assert.equal((await pool.query("SELECT count(*)::int c FROM trials WHERE nct_id = ANY($1)", [ids])).rows[0].c, 60);
  const h = await checkHealth();
  assert.equal(h.checks.find((c) => c.name === "removal guard")?.status, "warn");
  await pool.query("DELETE FROM app_meta WHERE key = 'prune_skipped'");
  await clean(ids);
});

test("health checks and abandoned runs", async () => {
  await runSyncForStudies([study("NCT88880041")]);
  // A run left 'running' for hours (e.g. killed by a time limit) is closed on the next start.
  const stuck = (await pool.query(
    "INSERT INTO sync_runs (status, mode, run_at) VALUES ('running', 'full', now() - interval '5 hours') RETURNING id")).rows[0].id;
  await runSyncForStudies([]);
  assert.equal((await pool.query("SELECT status FROM sync_runs WHERE id = $1", [stuck])).rows[0].status, "failed");

  const h = await checkHealth();
  const by = Object.fromEntries(h.checks.map((c) => [c.name, c.status]));
  assert.equal(by.database, "ok");
  assert.equal(by.migrations, "ok");
  assert.equal(by["last sync"], "ok");
  assert.equal(by.trials, "ok");

  await recordFailure("NCT88880042", "fetch", "x", null);
  await pool.query("UPDATE sync_failures SET status = 'dead' WHERE nct_id = 'NCT88880042'");
  const h2 = await checkHealth();
  assert.equal(h2.checks.find((c) => c.name === "failed records")?.status, "warn");
  assert.notEqual(h2.status, "fail");

  // Long without a successful sync -> fail.
  const later = new Date(Date.now() + 5 * 86400000);
  assert.equal((await checkHealth(later)).checks.find((c) => c.name === "last sync")?.status, "fail");
  await clean(["NCT88880041", "NCT88880042"]);
});
