// Research files (sync/data/profiles) -> drug pages. Needs DATABASE_URL (a test DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { checkProfileFile, dateSort, importProfiles, loadProfileFiles, type ProfileFile } from "./profiles.js";
import { deriveAuto } from "./enrich.js";

const SLUGS = ["zzsemaglutide", "zzamg133"];

after(async () => {
  await pool.query("DELETE FROM products WHERE slug = ANY($1)", [SLUGS]);
  await pool.end();
});

test("date labels sort by the first day of their period", () => {
  assert.equal(dateSort("2026-03-19"), "2026-03-19");
  assert.equal(dateSort("2026-03"), "2026-03-01");
  assert.equal(dateSort("2026-Q4"), "2026-10-01");
  assert.equal(dateSort("2026-H2"), "2026-07-01");
  assert.equal(dateSort("2027"), "2027-01-01");
  assert.equal(dateSort("late 2026"), null);
  assert.equal(dateSort(null), null);
});

test("the research files shipped with the code are valid", () => {
  const files = loadProfileFiles();
  assert.ok(files.length >= 1);
  for (const f of files) assert.deepEqual(checkProfileFile(f), [], f.source);
  const drugs = files.flatMap((f) => f.drugs.map((d) => d.name));
  for (const d of ["Semaglutide", "Tirzepatide", "Orforglipron", "Retatrutide"]) assert.ok(drugs.includes(d), d);
});

test("auto-fill: INN from the drug name or ChEMBL, API and regulatory status from openFDA", () => {
  const a = deriveAuto({
    slug: "survodutide", name: "Survodutide", trials: [{ phase: "PHASE3", sponsor: "Boehringer Ingelheim", sponsorClass: "INDUSTRY",
      conditions: ["Obesity"], names: ["Survodutide"], soleNames: ["Survodutide"], status: "RECRUITING", start: "2023-11-01", title: "x", otherNames: [] }],
    aliasKeys: [], lookup: null,
  });
  assert.equal(a.inn?.value, "Survodutide");
  assert.match(a.regulatory_status?.value ?? "", /^Investigational — Phase 3/);
  const b = deriveAuto({
    slug: "phentermine", name: "Phentermine", trials: [], aliasKeys: [],
    lookup: { v: 1, at: new Date().toISOString(), chembl: [], fda: { brands: ["Adipex-P"], routes: ["ORAL"], firstApproval: "1959-05-12", sponsors: [], generics: 30,
      marketed: true, epc: [], moa: [], ingredients: ["PHENTERMINE HYDROCHLORIDE"] } },
  });
  assert.equal(b.api?.value, "Phentermine Hydrochloride");
  assert.equal(b.regulatory_status?.value, "Approved — US FDA (1959)");
  // a code name is not an INN
  const c = deriveAuto({ slug: "vk2735", name: "VK2735", trials: [], aliasKeys: [], lookup: null });
  assert.equal(c.inn, undefined);
});

test("import: fields, results and milestones land on the page found by name or alias; re-runs keep hidden rows and manual rows", async () => {
  await pool.query("DELETE FROM products WHERE slug = ANY($1)", [SLUGS]);
  await pool.query("INSERT INTO products (slug, name) VALUES ('zzsemaglutide', 'ZZSemaglutide'), ('zzamg133', 'ZZAMG 133')");
  const file: ProfileFile = {
    source: "Test research",
    drugs: [
      {
        name: "ZZSemaglutide", fields: { inn: "Semaglutide", regulatory_status: "Approved", bogus: "x" } as never,
        sources: [{ label: "FDA", url: "https://www.fda.gov/" }],
        results: [{ kind: "efficacy", trial: "STEP 1", endpoint: "Weight", result: "−14.9%" }, { kind: "safety", trial: "STEP 1", result: "Nausea 44%" }],
        milestones: [
          { kind: "regulatory", title: "FDA approval", date: "2021-06-04", status: "done" },
          { kind: "patent", title: "US patent expiry", date: "2032-12-05" },
        ],
      },
      { name: "Maridebart cafraglutide", aliases: ["MariTide", "ZZAMG 133"], fields: { inn: "Maridebart cafraglutide" },
        milestones: [{ kind: "readout", title: "MARITIME-1 results", date: "2027" }] },
      { name: "ZZNo such drug", fields: { inn: "Nothing" } },
    ],
  };
  const r1 = await importProfiles([file]);
  assert.deepEqual(r1.unresolved, ["ZZNo such drug"]);
  assert.equal(r1.results, 2);
  assert.equal(r1.milestones, 3);

  const p = await pool.query("SELECT curated_info FROM products WHERE slug = 'zzsemaglutide'");
  assert.equal(p.rows[0].curated_info.inn.value, "Semaglutide");
  assert.equal(p.rows[0].curated_info.inn.source, "Test research: FDA");
  assert.equal(p.rows[0].curated_info.inn.url, "https://www.fda.gov/");
  assert.equal(p.rows[0].curated_info.bogus, undefined);
  const m = await pool.query("SELECT product_slug, date_sort::text, status FROM product_milestones WHERE product_slug = ANY($1) ORDER BY date_sort", [SLUGS]);
  assert.deepEqual(m.rows.map((x) => [x.product_slug, x.date_sort, x.status]), [
    ["zzsemaglutide", "2021-06-04", "done"], ["zzamg133", "2027-01-01", "expected"], ["zzsemaglutide", "2032-12-05", "expected"],
  ]);

  // An editor hides one curated row and adds a manual one; the file then drops the safety row.
  await pool.query("UPDATE product_milestones SET hidden = true WHERE product_slug = 'zzsemaglutide' AND kind = 'patent'");
  await pool.query("INSERT INTO product_results (product_slug, kind, result, origin) VALUES ('zzsemaglutide', 'efficacy', 'Own note', 'manual')");
  file.drugs[0].results = file.drugs[0].results!.slice(0, 1);
  const r2 = await importProfiles([file]);
  assert.equal(r2.removed, 1);
  const rows = await pool.query("SELECT origin, kind, result FROM product_results WHERE product_slug = 'zzsemaglutide' ORDER BY origin, id");
  assert.deepEqual(rows.rows.map((x) => `${x.origin}:${x.kind}:${x.result}`), ["curated:efficacy:−14.9%", "manual:efficacy:Own note"]);
  const hid = await pool.query("SELECT hidden FROM product_milestones WHERE product_slug = 'zzsemaglutide' AND kind = 'patent'");
  assert.equal(hid.rows[0].hidden, true);

  // A drug no longer in any file loses its research values.
  await importProfiles([{ source: "Test research", drugs: [file.drugs[0]] }]);
  const gone = await pool.query("SELECT curated_info FROM products WHERE slug = 'zzamg133'");
  assert.equal(gone.rows[0].curated_info, null);
  const goneM = await pool.query("SELECT count(*)::int AS n FROM product_milestones WHERE product_slug = 'zzamg133'");
  assert.equal(goneM.rows[0].n, 0);
});

test("import: every alias spelling links to the drug page; an alias that is its own page is reported", async () => {
  await pool.query("DELETE FROM product_aliases WHERE product_slug = ANY($1) OR alias_slug IN ('zzvt355', 'zzrelsi')", [SLUGS]);
  await pool.query("DELETE FROM products WHERE slug = ANY($1)", [SLUGS]);
  await pool.query("INSERT INTO products (slug, name) VALUES ('zzsemaglutide', 'ZZSemaglutide'), ('zzamg133', 'ZZAMG 133')");
  const res = await importProfiles([{ source: "Alias test", drugs: [
    { name: "ZZSemaglutide", aliases: ["ZZVT-355", "ZZVT 355", "ZZAMG133"], fields: { aliases: "ZZVT355, ZZRelsi" } },
  ] }]);
  const rows = (await pool.query<{ alias_slug: string }>("SELECT alias_slug FROM product_aliases WHERE product_slug = 'zzsemaglutide' ORDER BY 1")).rows;
  assert.deepEqual(rows.map((r) => r.alias_slug), ["zzrelsi", "zzvt355"]); // three spellings, one key
  assert.equal(res.aliases, 2);
  assert.ok(res.duplicates.some((d) => d.startsWith("ZZAMG133")), "an alias that is its own drug page is reported");
  await pool.query("DELETE FROM product_aliases WHERE product_slug = 'zzsemaglutide'");
});

test("auto-fill: glued-together registry spellings are not aliases", () => {
  const a = deriveAuto({ slug: "ribupatide", name: "Ribupatide", trials: [], lookup: null,
    aliasKeys: ["hrs9531", "hrs9531placebo", "kai9531"] });
  const list = (a.aliases?.value ?? "").split(", ");
  assert.ok(list.includes("HRS9531") && list.includes("KAI9531"), a.aliases?.value);
  assert.ok(!list.includes("HRS9531PLACEBO"), a.aliases?.value);
});
