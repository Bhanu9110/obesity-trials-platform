// Drug list clean-up (products.kind, merges) and drug-profile source status / health.
// Needs DATABASE_URL (a test DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { applyCuration, kindFromName, loadCuration } from "./curation.js";
import { recordSourceStatus } from "./enrich.js";
import { checkHealth } from "./health.js";
import { rebuildProducts, runSyncForStudies } from "./sync.js";

const SLUGS = ["zzmetformin", "zzmetformine", "zzcaloricrestriction", "zzgreentea", "zzbloodtests", "zzwalkingprogram"];

after(async () => {
  await pool.query("DELETE FROM trials WHERE nct_id LIKE 'NCT0888880%'");
  await pool.query("DELETE FROM products WHERE slug = ANY($1)", [SLUGS]);
  await pool.query("DELETE FROM product_aliases WHERE alias_slug = ANY($1)", [SLUGS]);
  await pool.query("DELETE FROM app_meta WHERE key = 'source_status'");
  await pool.end();
});

test("name rules: clear non-drugs only, never a drug arm", () => {
  assert.equal(kindFromName("Blood Tests")?.kind, "not_drug");
  assert.equal(kindFromName("Sleeve Gastrectomy")?.kind, "not_drug");
  assert.equal(kindFromName("Placebo injection")?.kind, "not_drug");
  assert.equal(kindFromName("Low-calorie Diet")?.kind, "not_drug");
  assert.equal(kindFromName("Behavioral + Orlistat"), null);   // a combination with a drug
  for (const drug of ["Semaglutide", "Diethylpropion", "Dietressa", "CT-996", "Metformin", "Glubran Surgical Glue"]) {
    assert.equal(kindFromName(drug), null, drug);
  }
  // The reviewed list ships with the code.
  const cur = loadCuration();
  assert.ok(Object.keys(cur.not_drug).length > 200);
  assert.ok(Object.keys(cur.supplement).length > 100);
  assert.ok(Object.keys(cur.merge).length > 50);
});

function study(nct: string, drug: string) {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, briefTitle: "Clean-up test" },
      statusModule: { lastUpdatePostDateStruct: { date: "2026-09-15" }, overallStatus: "RECRUITING", startDateStruct: { date: "2025-05" } },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Some University", class: "OTHER" } },
      conditionsModule: { conditions: ["Obesity"] },
      designModule: { phases: ["PHASE2"] },
      armsInterventionsModule: { interventions: [{ type: "DRUG", name: drug }] },
      contactsLocationsModule: { locations: [{ country: "India" }] },
    },
  };
}

test("clean-up: list, rules, merges — and a choice on the drug page wins", async () => {
  await pool.query("DELETE FROM products WHERE slug = ANY($1)", [SLUGS]);
  await runSyncForStudies([
    study("NCT08888801", "ZZMetformin"), study("NCT08888802", "ZZMetformine"),
    study("NCT08888803", "ZZCaloric Restriction"), study("NCT08888804", "ZZGreen Tea"),
    study("NCT08888805", "ZZ Blood Tests"),
  ] as any);
  await pool.query("UPDATE products SET sponsor = 'Hand-entered' WHERE slug = 'zzmetformine'");
  const cur = {
    not_drug: { zzcaloricrestriction: "Caloric Restriction" }, supplement: { zzgreentea: "Green Tea" }, drug: [],
    merge: { zzmetformine: { into: "zzmetformin", name: "ZZMetformin" } },
  };
  const r = await applyCuration(cur);
  assert.equal(r.merged, 1);
  assert.deepEqual(r.byRule.filter((n) => n.startsWith("ZZ")), ["ZZ Blood Tests"]);
  const kinds = async () => Object.fromEntries((await pool.query(
    "SELECT slug, kind, kind_source FROM products WHERE slug = ANY($1)", [SLUGS])).rows.map((x) => [x.slug, `${x.kind}/${x.kind_source}`]));
  assert.deepEqual(await kinds(), {
    zzmetformin: "null/null", zzcaloricrestriction: "not_drug/list", zzgreentea: "supplement/list", zzbloodtests: "not_drug/rule",
  });
  // The merged page's trial and hand-entered value moved; a product rebuild keeps it merged.
  const m = await pool.query("SELECT p.sponsor, count(tp.nct_id)::int AS n FROM products p JOIN trial_products tp ON tp.product_id = p.id WHERE p.slug = 'zzmetformin' GROUP BY p.id");
  assert.deepEqual(m.rows[0], { sponsor: "Hand-entered", n: 2 });
  await rebuildProducts();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM products WHERE slug = 'zzmetformine'")).rows[0].n, 0);

  // Set on the drug page: never changed by the list or the rules again.
  await pool.query("UPDATE products SET kind = NULL, kind_source = 'manual' WHERE slug = 'zzgreentea'");
  await pool.query("UPDATE products SET kind = NULL, kind_source = 'manual' WHERE slug = 'zzbloodtests'");
  await applyCuration(cur);
  assert.deepEqual(await kinds(), {
    zzmetformin: "null/null", zzcaloricrestriction: "not_drug/list", zzgreentea: "null/manual", zzbloodtests: "null/manual",
  });
  // Taken off the reviewed list: back in the drug list.
  await applyCuration({ ...cur, not_drug: {} });
  assert.equal((await kinds()).zzcaloricrestriction, "null/null");
});

test("source status: a failing streak keeps its start; 3 days down fails the health check", async () => {
  await pool.query("DELETE FROM app_meta WHERE key = 'source_status'");
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 19, 0));
  await recordSourceStatus({ openFDA: { ok: true, detail: "ok" }, "Inxight Drugs": { ok: false, detail: "HTTP 503" } }, day(1));
  let s = await recordSourceStatus({ "Inxight Drugs": { ok: false, detail: "HTTP 503" } }, day(2));
  assert.equal(s["Inxight Drugs"]?.failingSince, day(1).toISOString());
  assert.equal(s.openFDA?.ok, true);
  let h = await checkHealth(day(2));
  assert.equal(h.checks.find((c) => c.name === "drug-profile sources")?.status, "warn");
  await recordSourceStatus({ "Inxight Drugs": { ok: false, detail: "HTTP 503" } }, day(3));
  h = await checkHealth(day(3));
  const c = h.checks.find((x) => x.name === "drug-profile sources");
  assert.equal(c?.status, "fail");
  assert.match(c!.detail, /Inxight Drugs since 2026-10-01/);
  // Works again: the streak ends. Left out on purpose: never an alarm.
  s = await recordSourceStatus({ "Inxight Drugs": { ok: true, detail: "ok" } }, day(4));
  assert.equal(s["Inxight Drugs"]?.failingSince, null);
  await recordSourceStatus({ ChEMBL: { ok: true, detail: "", skipped: true } }, day(4));
  h = await checkHealth(day(4));
  assert.equal(h.checks.find((x) => x.name === "drug-profile sources")?.status, "ok");
});
