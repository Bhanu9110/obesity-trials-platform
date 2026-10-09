// Automatic drug profiles: derivation rules, ChEMBL / openFDA parsing, and a full
// run against a fake ChEMBL + openFDA server. Needs DATABASE_URL (a test DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  deriveAuto, parseFda, parseChemblMolecule, normalizeCondition, subclassFrom, enrichConfig, enrichProducts,
  aliasCandidates, titleAliases, otherNamesOf, refreshOtherNames, pageText, extractPipelinePairs, refreshPipelineAliases,
  type ChemblInfo, type Lookup, type TrialFact,
} from "./enrich.js";
import { runSyncForStudies } from "./sync.js";
import { pool } from "./db.js";
import { config } from "./config.js";

const trial = (over: Partial<TrialFact> = {}): TrialFact => ({
  phase: "PHASE3", sponsor: "Novo Nordisk A/S", sponsorClass: "INDUSTRY", conditions: ["Obesity"],
  names: ["Semaglutide"], soleNames: ["Semaglutide"], status: "COMPLETED", start: "2021-03", ...over,
});
const chembl = (over: Partial<ChemblInfo> = {}): ChemblInfo => ({
  id: "CHEMBL1", name: "SEMAGLUTIDE", type: "Protein", maxPhase: 4, firstApproval: 2017, oral: true, parenteral: true,
  topical: false, withdrawn: false, tradeNames: ["OZEMPIC", "WEGOVY"], codes: ["NN-9535", "NNC 0113-0217"],
  mechanisms: [{ moa: "Glucagon-like peptide 1 receptor agonist", action: "AGONIST" }], ...over,
});
const lookup = (c: (ChemblInfo | null)[], fda: Lookup["fda"] = null): Lookup => ({ v: 1, chembl: c, fda, at: "2026-10-01" });

// --------------------------------------------------------------------------- #
// Rules
// --------------------------------------------------------------------------- #
test("autofill: an approved peptide gets its full profile, with sources", () => {
  const a = deriveAuto({
    slug: "semaglutide", name: "Semaglutide", aliasKeys: ["wegovy", "ozempic"],
    trials: [trial(), trial({ conditions: ["Type 2 Diabetes Mellitus"] }), trial({ conditions: ["Overweight or Obesity"] })],
    lookup: lookup([chembl()], {
      brands: ["WEGOVY", "OZEMPIC", "RYBELSUS"], routes: ["SUBCUTANEOUS", "ORAL"], firstApproval: "2017-12-05",
      sponsors: ["NOVO"], generics: 0, marketed: true, epc: ["GLP-1 Receptor Agonist [EPC]"], moa: [],
    }),
  });
  assert.deepEqual(a.approved, { value: "Yes", source: "openFDA" });
  assert.equal(a.approval_date?.value, "2017-12-05");
  assert.equal(a.phase?.value, "Approved");
  assert.deepEqual(a.candidate, { value: "Pipeline", source: "Industry (Novo Nordisk A/S)" }); // a company's drug
  assert.equal(a.sponsor?.value, "Novo Nordisk A/S");           // FDA "NOVO" written as the trials write it
  assert.equal(a.brand_names?.value, "Wegovy, Ozempic, Rybelsus");
  assert.equal(a.modality?.value, "Peptide");
  assert.equal(a.therapy_subclass?.value, "GLP-1 receptor agonist");
  assert.equal(a.drug_class?.value, "Incretin-based therapy");
  assert.equal(a.moa?.value, "Glucagon-like peptide 1 receptor agonist");
  assert.equal(a.roa?.value, "Subcutaneous, Oral");
  assert.equal(a.aliases?.value, "NN-9535, NNC 0113-0217");
  assert.equal(a.indication?.value, "Obesity, Overweight, Type 2 diabetes");
  assert.equal(a.parent_drug, undefined);
});

test("autofill: mechanisms decide the subclass (dual, triple, oral small molecule)", () => {
  assert.equal(subclassFrom("Glucagon-like peptide 1 receptor agonist; Gastric inhibitory polypeptide receptor agonist"), "GIP/GLP-1 dual agonist");
  assert.equal(subclassFrom("Glucagon-like peptide 1 receptor agonist; Gastric inhibitory polypeptide receptor agonist; Glucagon receptor agonist"),
    "GIP/GLP-1/glucagon triple agonist");
  assert.equal(subclassFrom("Glucagon-like peptide 1 receptor agonist; Glucagon receptor agonist"), "GLP-1/glucagon dual agonist");
  assert.equal(subclassFrom("Glucagon-like peptide 1 receptor agonist", true), "Oral small-molecule GLP-1 RA");
  assert.equal(subclassFrom("Glucagon-like peptide 1 receptor agonist; Gastric inhibitory polypeptide receptor antagonist"), "GLP-1 agonist / GIPR antagonist");
  assert.equal(subclassFrom("Amylin receptor agonist; Calcitonin receptor agonist"), "Amylin analogue");
  assert.equal(subclassFrom("Melanocortin receptor 4 agonist"), "MC4R agonist");
  assert.equal(subclassFrom("Undisclosed GLP-1 receptor agonist"), "GLP-1 receptor agonist");
  assert.equal(subclassFrom("Something else"), null);
});

test("autofill: a pipeline drug from trials only, without a lookup", () => {
  const a = deriveAuto({
    slug: "zentaglutide", name: "Zentaglutide", aliasKeys: [], lookup: null, now: new Date("2026-10-08"),
    trials: [
      trial({ phase: "PHASE2", sponsor: "Acme Bio", status: "RECRUITING", start: "2025-06", names: ["Zentaglutide (AB-1234) injection"], soleNames: ["Zentaglutide (AB-1234) injection"] }),
      trial({ phase: "PHASE2, PHASE3", sponsor: "Acme Bio", status: "NOT_YET_RECRUITING", start: "2026-02", names: ["AB-1234 s.c."], soleNames: ["AB-1234 s.c."] }),
    ],
  });
  assert.equal(a.phase?.value, "Phase 2/3");
  assert.equal(a.candidate?.value, "Pipeline");
  assert.equal(a.sponsor?.value, "Acme Bio");
  assert.equal(a.aliases?.value, "AB-1234");
  assert.equal(a.roa?.value, "Subcutaneous");
  assert.equal(a.modality?.value, "Peptide");
  assert.equal(a.approved, undefined);    // no evidence either way
  assert.equal(a.brand_names, undefined);
});

test("autofill: withdrawn, combination and generic drugs", () => {
  const w = deriveAuto({
    slug: "rimonabant", name: "Rimonabant", aliasKeys: [], trials: [trial({ sponsor: "Sanofi", start: "2005-01" })],
    lookup: lookup([chembl({ type: "Small molecule", withdrawn: true, mechanisms: [{ moa: "Cannabinoid CB1 receptor inverse agonist", action: "INVERSE AGONIST" }] })]),
  });
  assert.equal(w.phase?.value, "Withdrawn");
  assert.equal(w.candidate?.value, "Pipeline");            // industry drug (Sanofi), even though withdrawn
  assert.equal(w.therapy_subclass?.value, "CB1 receptor antagonist");
  assert.equal(w.drug_class?.value, "Centrally acting anti-obesity agent");
  assert.equal(w.modality?.value, "Small molecule");

  const c = deriveAuto({
    slug: "phentermine_topiramate", name: "Phentermine + Topiramate", aliasKeys: ["qsymia"], trials: [trial({ sponsor: "VIVUS LLC" })],
    lookup: lookup([null, null], {
      brands: ["QSYMIA"], routes: ["ORAL"], firstApproval: "2012-07-17", sponsors: ["VIVUS"], generics: 0, marketed: true, epc: [], moa: [],
    }),
  });
  assert.equal(c.parent_drug?.value, "Phentermine, Topiramate");
  assert.equal(c.modality?.value, "Combination");
  assert.equal(c.brand_names?.value, "Qsymia, Qnexa"); // FDA brand, then the former name from the alias list
  assert.equal(c.approval_date?.value, "2012-07-17");
  assert.equal(c.sponsor?.value, "VIVUS LLC");

  const g = deriveAuto({
    slug: "metformin", name: "Metformin", aliasKeys: ["glucophage"],
    trials: [trial({ sponsor: "University A", sponsorClass: "OTHER", conditions: ["Insulin Resistance"] })],
    lookup: lookup([chembl({ type: "Small molecule", mechanisms: [] })], {
      brands: ["GLUCOPHAGE"], routes: ["ORAL"], firstApproval: "1994-12-29", sponsors: ["EMD SERONO"], generics: 40, marketed: true,
      epc: ["Biguanide [EPC]"], moa: [],
    }),
  });
  assert.equal(g.sponsor?.value, "Generic (several companies)");
  assert.equal(g.therapy_subclass?.value, "Biguanide");
  assert.equal(g.drug_class?.value, "Antidiabetic");
  assert.deepEqual(g.candidate, { value: "Non-pipeline", source: "Generic, no developing company" });
});

test("autofill: pipeline = industry drug, non-pipeline = academic drug", () => {
  const academic = deriveAuto({
    slug: "berberine", name: "Berberine", aliasKeys: [], lookup: null,
    trials: [trial({ sponsor: "University of X", sponsorClass: "OTHER" }), trial({ sponsor: "NIH", sponsorClass: "NIH" })],
  });
  assert.deepEqual(academic.candidate, { value: "Non-pipeline", source: "Academic (no industry-sponsored trials)" });
  assert.equal(academic.sponsor, undefined);

  const scattered = deriveAuto({
    slug: "vitamin_d", name: "Vitamin D", aliasKeys: [], lookup: null,
    trials: [trial({ sponsor: "Pharma A", sponsorClass: "INDUSTRY" }), trial({ sponsor: "Pharma B", sponsorClass: "INDUSTRY" }),
             trial({ sponsor: "Pharma C", sponsorClass: "INDUSTRY" }), trial({ sponsor: "Uni", sponsorClass: "OTHER" })],
  });
  assert.deepEqual(scattered.candidate, { value: "Non-pipeline", source: "Academic (no single developing company)" });

  const industry = deriveAuto({
    slug: "zentaglutide", name: "Zentaglutide", aliasKeys: [], lookup: null,
    trials: [trial({ sponsor: "Acme Bio", start: "2012-01", status: "COMPLETED" }), trial({ sponsor: "Uni", sponsorClass: "OTHER" })],
  });
  assert.deepEqual(industry.candidate, { value: "Pipeline", source: "Industry (Acme Bio)" });
});

test("autofill: aliases from ClinicalTrials.gov other names and trial titles", () => {
  assert.deepEqual(aliasCandidates("CT-388"), ["CT-388"]);
  assert.deepEqual(aliasCandidates("ribupatide; HRS-9531 injection"), ["HRS-9531", "Ribupatide"]);
  assert.deepEqual(aliasCandidates("Matching placebo"), []);
  assert.deepEqual(titleAliases("Enicepatide", ["A Study of Enicepatide (CT-388) in Participants With Obesity"]), ["CT-388"]);
  assert.deepEqual(titleAliases("Enicepatide", ["A Study of CT-388 (Enicepatide) in Adults"]), ["CT-388"]);
  assert.deepEqual(titleAliases("Enicepatide", ["Enicepatide (Once-Weekly) in Obesity"]), []);   // no code inside
  assert.deepEqual(otherNamesOf({ protocolSection: { identificationModule: { nctId: "NCT1" },
    armsInterventionsModule: { interventions: [{ name: "Enicepatide", otherNames: ["CT-388", "RO7795081"] }, { name: "Placebo" }] } } }),
    [{ nct: "NCT1", intervention: "Enicepatide", other: "CT-388" }, { nct: "NCT1", intervention: "Enicepatide", other: "RO7795081" }]);

  const a = deriveAuto({
    slug: "enicepatide", name: "Enicepatide", aliasKeys: ["ct388", "rg6640"], lookup: null,
    trials: [
      trial({ sponsor: "Carmot Therapeutics, Inc.", names: ["Enicepatide"], soleNames: ["Enicepatide"],
              title: "A Study of Enicepatide (CT-388) in Participants With Obesity", otherNames: ["CT-388", "RO7795081"] }),
      trial({ sponsor: "Hoffmann-La Roche", names: ["Enicepatide"], soleNames: ["Enicepatide"], title: "A Study of Enicepatide in Obesity" }),
    ],
  });
  // CT.gov spelling wins over the alias-list spelling (CT-388, not CT388); RG6640 comes from the alias list.
  assert.deepEqual(a.aliases, { value: "CT-388, RO7795081, RG6640", source: "ClinicalTrials.gov + Alias list" });
  const b = deriveAuto({
    slug: "enicepatide", name: "Enicepatide", aliasKeys: ["ct388", "rg6640"], lookup: null,
    pipelineAliases: [{ alias: "RG6640", company: "Roche" }, { alias: "CT-388", company: "Roche" }], trials: [trial()],
  });
  assert.deepEqual(b.aliases, { value: "RG6640, CT-388", source: "Company pipeline (Roche)" });
});

test("company pipeline pages: code names next to tracked drugs", () => {
  const html = `<html><head><style>.x{}</style><script>var a = "RG9999 Enicepatide";</script></head><body>
    <div class="row"><span>RG6640</span><h3>Enicepatide (CT-388)</h3><p>obesity +/- Type 2 diabetes</p></div>
    <div class="row"><span>RG7777</span><h3>Petrelintide &amp; partners</h3></div>
    <table><tr><td>LY3437943</td><td>Retatrutide</td><td>Phase 3</td></tr>
           <tr><td>Tirzepatide / Retatrutide combination LY9999999</td></tr></table>
    <p>HRS9531 (ribupatide) Phase 3</p>
    <script id="__NEXT_DATA__" type="application/json">{"props":{"items":[{"name":"Orforglipron","code":"LY3502970"}]}}</script>
  </body></html>`;
  const text = pageText(html);
  assert.ok(!text.includes("RG9999"));                       // script code is ignored
  assert.ok(text.includes("Orforglipron") && text.includes("LY3502970")); // embedded JSON data is read
  const drugs = [
    { slug: "enicepatide", name: "Enicepatide" }, { slug: "petrelintide", name: "Petrelintide" },
    { slug: "retatrutide", name: "Retatrutide" }, { slug: "tirzepatide", name: "Tirzepatide" },
    { slug: "hrs9531", name: "HRS9531" }, { slug: "orforglipron", name: "Orforglipron" },
  ];
  const pairs = extractPipelinePairs(text, drugs).map((p) => `${p.slug}=${p.alias}`).sort();
  assert.deepEqual(pairs, [
    "enicepatide=CT-388", "enicepatide=RG6640", "hrs9531=Ribupatide", "orforglipron=LY3502970",
    "petrelintide=RG7777", "retatrutide=LY3437943",
  ]);   // the combination line names two drugs, so LY9999999 is not given to either
});

test("autofill: conditions are normalised and merged", () => {
  assert.deepEqual(normalizeCondition("Diabetes Mellitus, Type 2"), ["Type 2 diabetes"]);
  assert.deepEqual(normalizeCondition("Overweight and Obesity"), ["Obesity", "Overweight"]);
  assert.deepEqual(normalizeCondition("Nonalcoholic Steatohepatitis"), ["MASH (NASH)"]);
  assert.deepEqual(normalizeCondition("Chronic weight management"), ["Weight management"]);
  assert.deepEqual(normalizeCondition("  "), []);
});

// --------------------------------------------------------------------------- #
// Parsers
// --------------------------------------------------------------------------- #
test("parsers: ChEMBL molecule and openFDA applications", () => {
  const m = parseChemblMolecule(
    {
      molecule_chembl_id: "CHEMBL9", pref_name: "TESTAGLUTIDE", molecule_type: "Protein", max_phase: "3.0", first_approval: null,
      oral: false, parenteral: true, topical: false, withdrawn_flag: false,
      molecule_synonyms: [
        { molecule_synonym: "TG-101", syn_type: "RESEARCH_CODE" }, { molecule_synonym: "TG101", syn_type: "RESEARCH_CODE" },
        { molecule_synonym: "Testaglutide", syn_type: "INN" }, { molecule_synonym: "TESTAVY", syn_type: "TRADE_NAME" },
      ],
    },
    [{ mechanism_of_action: "Glucagon-like peptide 1 receptor agonist", action_type: "AGONIST" },
     { mechanism_of_action: "glucagon-like peptide 1 receptor agonist", action_type: "AGONIST" }],
  );
  assert.equal(m.maxPhase, 3);
  assert.deepEqual(m.codes, ["TG-101"]);          // TG101 is the same code
  assert.deepEqual(m.tradeNames, ["TESTAVY"]);
  assert.equal(m.mechanisms.length, 1);

  const f = parseFda([
    { application_number: "NDA020357", sponsor_name: "EMD SERONO",
      products: [{ brand_name: "GLUCOPHAGE", route: "ORAL", marketing_status: "Prescription", active_ingredients: [{ name: "METFORMIN HYDROCHLORIDE" }] }],
      submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "19941229" },
                    { submission_type: "SUPPL", submission_status: "AP", submission_status_date: "19900101" }],
      openfda: { pharm_class_epc: ["Biguanide [EPC]"] } },
    { application_number: "ANDA075000", sponsor_name: "SOME GENERIC",
      products: [{ brand_name: "METFORMIN HYDROCHLORIDE", route: "ORAL", marketing_status: "Prescription", active_ingredients: [{ name: "METFORMIN HYDROCHLORIDE" }] }],
      submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20020101" }] },
    { application_number: "NDA021995", sponsor_name: "MERCK",   // a combination: not plain metformin
      products: [{ brand_name: "JANUMET", route: "ORAL", active_ingredients: [{ name: "METFORMIN HYDROCHLORIDE" }, { name: "SITAGLIPTIN PHOSPHATE" }] }],
      submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20070330" }] },
  ], ["Metformin"]);
  assert.ok(f);
  assert.deepEqual(f!.brands, ["GLUCOPHAGE"]);
  assert.equal(f!.firstApproval, "1994-12-29");
  assert.equal(f!.generics, 1);
  assert.deepEqual(f!.sponsors, ["EMD SERONO"]);
  assert.deepEqual(f!.routes, ["ORAL"]);
  assert.equal(parseFda([], ["Nothing"]), null);
});

// --------------------------------------------------------------------------- #
// Full run against a fake ChEMBL + openFDA
// --------------------------------------------------------------------------- #
const MOLS: Record<string, any> = {
  TESTAGLUTIDE: {
    molecule_chembl_id: "CHEMBL900001", pref_name: "TESTAGLUTIDE", molecule_type: "Protein", max_phase: "4.0",
    first_approval: 2024, oral: false, parenteral: true, topical: false, withdrawn_flag: false,
    molecule_hierarchy: { molecule_chembl_id: "CHEMBL900001", parent_chembl_id: "CHEMBL900001" },
    molecule_synonyms: [{ molecule_synonym: "TG-101", syn_type: "RESEARCH_CODE" }],
  },
};
let fdaDown = false;
let calls = 0;
const server = http.createServer((req, res) => {
  calls++;
  const u = new URL(req.url ?? "/", "http://x");
  const send = (code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/chembl/molecule.json") {
    const q = (u.searchParams.get("pref_name__iexact") ?? u.searchParams.get("molecule_synonyms__molecule_synonym__iexact") ?? "").toUpperCase();
    return send(200, { molecules: MOLS[q] ? [MOLS[q]] : [], page_meta: { total_count: MOLS[q] ? 1 : 0 } });
  }
  if (u.pathname === "/chembl/mechanism.json") {
    const ids = (u.searchParams.get("molecule_chembl_id__in") ?? "").split(",");
    return send(200, { mechanisms: ids.includes("CHEMBL900001") ? [
      { mechanism_of_action: "Glucagon-like peptide 1 receptor agonist", action_type: "AGONIST", molecule_chembl_id: "CHEMBL900001" },
      { mechanism_of_action: "Gastric inhibitory polypeptide receptor agonist", action_type: "AGONIST", molecule_chembl_id: "CHEMBL900001" },
    ] : [] });
  }
  if (u.pathname === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nDisallow: /private/\n"); }
  if (u.pathname === "/pipeline") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><body>" + "<p>filler</p>".repeat(200) + "<li>Testaglutide (TG-777) – obesity – Phase 3</li></body></html>"); }
  if (u.pathname === "/ctgov/studies") {
    const ids = (u.searchParams.get("filter.ids") ?? "").split(",");
    return send(200, { studies: ids.filter((id) => id === "NCT09999901").map((id) => ({ protocolSection: {
      identificationModule: { nctId: id },
      armsInterventionsModule: { interventions: [{ name: "Testaglutide (TG-101) subcutaneous injection", otherNames: ["TG-101", "Testavy"] }] } } })) });
  }
  if (u.pathname === "/fda/drug/drugsfda.json") {
    if (fdaDown) return send(503, { error: "down" });
    const search = u.searchParams.get("search") ?? "";
    if (search.includes("TESTAGLUTIDE")) return send(200, { results: [{
      application_number: "NDA299999", sponsor_name: "ACME",
      products: [{ brand_name: "TESTAVY", route: "SUBCUTANEOUS", marketing_status: "Prescription", active_ingredients: [{ name: "TESTAGLUTIDE" }] }],
      submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20240315" }],
    }] });
    return send(404, { error: { code: "NOT_FOUND" } });
  }
  send(404, {});
});

after(async () => {
  server.close();
  await pool.query("DELETE FROM trials WHERE nct_id LIKE 'NCT0999990%'");
  await pool.query("DELETE FROM products WHERE slug IN ('testaglutide', 'obscurazine')");
  await pool.end();
});

function study(nct: string, drug: string, sponsor = "Acme Pharma") {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, briefTitle: "Autofill test" },
      statusModule: { lastUpdatePostDateStruct: { date: "2026-09-15" }, overallStatus: "RECRUITING", startDateStruct: { date: "2025-05" } },
      sponsorCollaboratorsModule: { leadSponsor: { name: sponsor, class: "INDUSTRY" } },
      conditionsModule: { conditions: ["Obesity"] },
      designModule: { phases: ["PHASE3"] },
      armsInterventionsModule: { interventions: [{ type: "DRUG", name: drug }] },
      contactsLocationsModule: { locations: [{ country: "India" }] },
    },
  };
}

test("enrich run: fills blanks from trials + references, never touches hand-entered fields", async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(enrichConfig, { chemblBase: `${base}/chembl`, fdaBase: `${base}/fda`, delayMs: 0, timeoutMs: 5000 });

  await pool.query("DELETE FROM products WHERE slug IN ('testaglutide', 'obscurazine')");
  await runSyncForStudies([
    study("NCT09999901", "Testaglutide (TG-101) subcutaneous injection"),
    study("NCT09999902", "Testaglutide"),
    study("NCT09999903", "Obscurazine tablet", "Tiny Biotech"),
  ] as any);
  // A hand-entered value that must survive.
  await pool.query("UPDATE products SET sponsor = 'Hand-entered Co' WHERE slug = 'testaglutide'");

  const r = await enrichProducts({ only: ["testaglutide", "obscurazine"] });
  assert.equal(r.products, 2);
  assert.equal(r.lookedUp, 2);
  assert.equal(r.chemblFound, 1);
  assert.equal(r.fdaFound, 1);
  assert.deepEqual(r.sourcesDown, []);

  const row = async (slug: string) =>
    (await pool.query("SELECT sponsor, auto_info, auto_checked_at FROM products WHERE slug = $1", [slug])).rows[0];
  const t = await row("testaglutide");
  assert.equal(t.sponsor, "Hand-entered Co");                  // manual column untouched
  assert.equal(t.auto_info.sponsor.value, "Acme Pharma");      // the automatic value is kept beside it
  assert.equal(t.auto_info.brand_names.value, "Testavy");
  assert.equal(t.auto_info.approval_date.value, "2024-03-15");
  assert.equal(t.auto_info.therapy_subclass.value, "GIP/GLP-1 dual agonist");
  assert.equal(t.auto_info.modality.value, "Peptide");
  assert.equal(t.auto_info.roa.value, "Subcutaneous");
  assert.equal(t.auto_info.aliases.value, "TG-101");
  assert.equal(t.auto_info.phase.value, "Approved");
  assert.ok(t.auto_checked_at);

  const o = await row("obscurazine");
  assert.equal(o.auto_info.roa.value, "Oral");
  assert.equal(o.auto_info.phase.value, "Phase 3");
  assert.equal(o.auto_info.candidate.value, "Pipeline");
  assert.equal(o.auto_info.approved, undefined);

  // Nothing due: a second run makes no calls.
  const before = calls;
  const r2 = await enrichProducts({ only: ["testaglutide", "obscurazine"] });
  assert.equal(r2.lookedUp, 0);
  assert.equal(calls, before);

  // A source that is down: noted, skipped, and the drug is retried next run.
  await pool.query("UPDATE products SET auto_checked_at = NULL, auto_lookup = NULL WHERE slug = 'obscurazine'");
  fdaDown = true;
  const r3 = await enrichProducts({ only: ["obscurazine"] });
  assert.equal(r3.sourcesDown.length, 1);
  assert.match(r3.sourcesDown[0], /openFDA/);
  assert.equal((await row("obscurazine")).auto_checked_at, null);
  fdaDown = false;

  // ClinicalTrials.gov other names are stored per trial intervention.
  (config.ctgov as { baseUrl: string }).baseUrl = `${base}/ctgov`;
  const on = await refreshOtherNames();
  assert.ok(on && on.names >= 2);
  const stored = await pool.query("SELECT other_name FROM intervention_other_names WHERE nct_id = 'NCT09999901' ORDER BY 1");
  assert.deepEqual(stored.rows.map((r) => r.other_name), ["TG-101", "Testavy"]);

  // Company pipeline pages: known entries + a page, robots.txt respected.
  const rep = await refreshPipelineAliases([{ slug: "testaglutide", name: "Testaglutide" }], undefined, {
    force: true,
    sources: {
      pages: [{ company: "Acme", url: `${base}/pipeline` }, { company: "Hidden", url: `${base}/private/pipeline` }],
      known: [{ company: "Acme", drug: "Testaglutide", aliases: ["AC-101"] }],
    },
  });
  assert.deepEqual(rep?.map((r) => [r.company, r.status, r.found]), [["Acme", "ok", 1], ["Hidden", "skipped (robots.txt)", 0]]);
  const codes = await pool.query("SELECT alias, company FROM pipeline_code_names WHERE product_slug = 'testaglutide' ORDER BY alias");
  assert.deepEqual(codes.rows.map((r) => `${r.alias}/${r.company}`), ["AC-101/Acme", "TG-777/Acme"]);
  await enrichProducts({ only: ["testaglutide"], external: false });
  const al = (await pool.query("SELECT auto_info->'aliases' AS a FROM products WHERE slug = 'testaglutide'")).rows[0].a;
  assert.equal(al.value, "AC-101, TG-777, TG-101");
  assert.equal(al.source, "Company pipeline (Acme) + ChEMBL");
  await pool.query("DELETE FROM pipeline_code_names WHERE product_slug = 'testaglutide'");

  // Trial data only (no network).
  const r4 = await enrichProducts({ only: ["obscurazine"], external: false });
  assert.equal(r4.lookedUp, 0);
});
