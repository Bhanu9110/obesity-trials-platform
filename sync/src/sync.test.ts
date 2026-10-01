import { test } from "node:test";
import assert from "node:assert/strict";
import { mapStudy } from "./mapper.js";
import { productsFromName, deriveTrialProducts } from "./products.js";
import { runSyncForStudies, rebuildProducts } from "./sync.js";
import { isObesityIndication } from "./obesity-filter.js";
import { pool } from "./db.js";

// A realistic (trimmed) CT.gov v2 study payload.
function study(nct: string, over: { conditions?: string[]; interventions?: any[]; countries?: string[]; phase?: string[] } = {}) {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, briefTitle: "ignored" },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Test Pharma Inc.", class: "INDUSTRY" } },
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
    "conditions", "countries", "interventions", "lead_sponsor_class", "nct_id", "phase", "sponsor",
  ]);
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

test.after(async () => {
  await pool.end();
});
