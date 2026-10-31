// PubMed papers: XML parsing, results-paper rule, drug search term, and linking (PubMed mocked).
// Needs DATABASE_URL (a test DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { drugTerm, isResultsPaper, linkDrugPapers, linkTrialPapers, parsePubmedXml } from "./pubmed.js";
import { runSyncForStudies } from "./sync.js";

const article = (pmid: string, o: { title: string; types: string[]; ncts?: string[]; abstract?: string; authors?: number }) => `
<PubmedArticle><MedlineCitation Status="MEDLINE" Owner="NLM"><PMID Version="1">${pmid}</PMID>
<Article PubModel="Print-Electronic"><Journal><JournalIssue CitedMedium="Internet"><Volume>384</Volume>
<PubDate><Year>2024</Year><Month>Mar</Month><Day>14</Day></PubDate></JournalIssue><Title>The New England journal of medicine</Title>
<ISOAbbreviation>N Engl J Med</ISOAbbreviation></Journal><ArticleTitle>${o.title}</ArticleTitle>
<ELocationID EIdType="doi" ValidYN="Y">10.1056/NEJMoa${pmid}</ELocationID>
<Abstract><AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Obesity &amp; weight &lt;loss&gt;.</AbstractText>
<AbstractText Label="METHODS">${o.abstract ?? "We randomly assigned adults."}</AbstractText></Abstract>
<AuthorList CompleteYN="Y">${Array.from({ length: o.authors ?? 4 }, (_, i) => `<Author ValidYN="Y"><LastName>Author${i}</LastName><ForeName>A</ForeName><Initials>A${i}</Initials></Author>`).join("")}</AuthorList>
<PublicationTypeList>${o.types.map((t) => `<PublicationType UI="D0">${t}</PublicationType>`).join("")}</PublicationTypeList></Article>
${o.ncts?.length ? `<DataBankList CompleteYN="Y"><DataBank><DataBankName>ClinicalTrials.gov</DataBankName><AccessionNumberList>${o.ncts.map((n) => `<AccessionNumber>${n}</AccessionNumber>`).join("")}</AccessionNumberList></DataBank></DataBankList>` : ""}
</MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">${pmid}</ArticleId></ArticleIdList>
<ReferenceList><Reference><Citation>Cited paper NCT99999999</Citation><ArticleIdList><ArticleId IdType="doi">10.1/ref</ArticleId></ArticleIdList></Reference></ReferenceList>
</PubmedData></PubmedArticle>`;

test("PubMed XML: the fields we keep", () => {
  const [p] = parsePubmedXml(`<PubmedArticleSet>${article("38000001", {
    title: "Once-Weekly <i>Semaglutide</i> in Adults with Overweight or Obesity", types: ["Journal Article", "Randomized Controlled Trial"],
    ncts: ["NCT03548935"], abstract: "Registered as NCT 03552757.", authors: 5,
  })}</PubmedArticleSet>`);
  assert.equal(p.pmid, "38000001");
  assert.equal(p.title, "Once-Weekly Semaglutide in Adults with Overweight or Obesity");
  assert.equal(p.journal, "The New England journal of medicine");
  assert.equal(p.pub_date, "2024 Mar 14");
  assert.equal(p.pub_year, 2024);
  assert.equal(p.authors, "Author0 A0, Author1 A1, Author2 A2, et al.");
  assert.equal(p.doi, "10.1056/NEJMoa38000001");
  assert.match(p.abstract!, /^BACKGROUND: Obesity & weight <loss>\.\nMETHODS: Registered as NCT 03552757\.$/);
  assert.deepEqual(p.accession_ncts, ["NCT03548935"]);
  assert.deepEqual(p.text_ncts, ["NCT03552757"]); // the reference list is ignored
});

test("results papers: trial reports yes; protocols, design papers and reviews no", () => {
  assert.equal(isResultsPaper({ title: "Tirzepatide once weekly for obesity", pub_types: ["Journal Article", "Clinical Trial, Phase III"] }), true);
  assert.equal(isResultsPaper({ title: "Post hoc analysis of STEP 1", pub_types: ["Randomized Controlled Trial"] }), true);
  assert.equal(isResultsPaper({ title: "Rationale and design of the SURMOUNT-MMO trial", pub_types: ["Clinical Trial"] }), false);
  assert.equal(isResultsPaper({ title: "Study protocol", pub_types: ["Clinical Trial Protocol"] }), false);
  assert.equal(isResultsPaper({ title: "GLP-1 agonists in obesity", pub_types: ["Review"] }), false);
  assert.equal(isResultsPaper({ title: "Weight loss in mice", pub_types: ["Journal Article"] }), false);
});

test("drug search term: names as phrases, combinations need both, junk left out", () => {
  assert.equal(drugTerm(["Semaglutide", "semaglutide", "Wegovy®", "NN9536", "GLP"]), '"Semaglutide"[tiab] OR "Wegovy"[tiab] OR "NN9536"[tiab]');
  assert.equal(drugTerm(["Bupropion + Naltrexone"]), '("Bupropion"[tiab] AND "Naltrexone"[tiab])');
  assert.equal(drugTerm(["Undisclosed GLP-1 agonist", "placebo", "123456"]), null);
});

// --------------------------------------------------------------------------- #
// Linking, with PubMed answered by a stub
// --------------------------------------------------------------------------- #
const realFetch = globalThis.fetch;
function stubPubmed(search: (term: string) => { count: number; ids: string[] }, xml: (ids: string[]) => string) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push(`${String(url).split("/").pop()} ${body.get("term") ?? body.get("id")}`);
    if (String(url).includes("esearch")) {
      const r = search(body.get("term") ?? "");
      return new Response(JSON.stringify({ esearchresult: { count: String(r.count), idlist: r.ids } }), { status: 200 });
    }
    return new Response(xml((body.get("id") ?? "").split(",")), { status: 200 });
  }) as typeof fetch;
  return calls;
}
after(async () => {
  globalThis.fetch = realFetch;
  await pool.query("DELETE FROM trials WHERE nct_id LIKE 'NCT9999600%'");
  await pool.query("DELETE FROM publications WHERE pmid LIKE '3900000%'");
  await pool.end();
});

const study = (nct: string, drug: string) => ({
  protocolSection: {
    identificationModule: { nctId: nct, briefTitle: "A study" },
    statusModule: { overallStatus: "COMPLETED", startDateStruct: { date: "2022-01" }, lastUpdatePostDateStruct: { date: "2026-09-01" } },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Test Pharma Inc.", class: "INDUSTRY" } },
    conditionsModule: { conditions: ["Obesity"] },
    designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 300 } },
    armsInterventionsModule: { interventions: [{ type: "DRUG", name: drug }] },
    contactsLocationsModule: { locations: [{ facility: "Site", city: "City", country: "Germany" }] },
  },
});

test("trial papers: linked by secondary ID or abstract, results marked, re-check replaces links", async () => {
  await runSyncForStudies([study("NCT99996001", "Zzpubmedtide"), study("NCT99996002", "Zzpubmedtide")] as any);
  const xml = (ids: string[]) => `<PubmedArticleSet>${ids.map((id) => ({
    "39000001": article("39000001", { title: "Zzpubmedtide for obesity", types: ["Randomized Controlled Trial"], ncts: ["NCT99996001"] }),
    "39000002": article("39000002", { title: "Design of a trial", types: ["Clinical Trial"], abstract: "Registration NCT99996001 and NCT99996002." }),
    "39000003": article("39000003", { title: "Unrelated", types: ["Journal Article"], ncts: ["NCT11111111"] }),
  } as Record<string, string>)[id] ?? "").join("")}</PubmedArticleSet>`;
  const calls = stubPubmed(() => ({ count: 3, ids: ["39000001", "39000002", "39000003"] }), xml);
  const r = await linkTrialPapers({ ids: ["NCT99996001", "NCT99996002"] });
  assert.deepEqual({ ...r, newPapers: undefined }, { trialsChecked: 2, trialPapers: 3, resultsPapers: 1, newPapers: undefined, stoppedEarly: false });
  assert.match(calls[0], /^esearch\.fcgi NCT99996001\[si\] OR NCT99996001\[tiab\] OR NCT99996002\[si\]/);
  const links = (await pool.query("SELECT nct_id, pmid, is_results, found_by FROM trial_publications WHERE nct_id LIKE 'NCT9999600%' ORDER BY 1, 2")).rows;
  assert.deepEqual(links, [
    { nct_id: "NCT99996001", pmid: "39000001", is_results: true, found_by: "secondary_id" },
    { nct_id: "NCT99996001", pmid: "39000002", is_results: false, found_by: "abstract" },
    { nct_id: "NCT99996002", pmid: "39000002", is_results: false, found_by: "abstract" },
  ]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM publications WHERE pmid = '39000003'")).rows[0].n, 0); // not linked → not stored
  const checked = await pool.query("SELECT count(*)::int AS n FROM trials WHERE nct_id LIKE 'NCT9999600%' AND pubmed_checked_at IS NOT NULL");
  assert.equal(checked.rows[0].n, 2);
  // PubMed no longer returns the design paper: its links go.
  stubPubmed(() => ({ count: 1, ids: ["39000001"] }), xml);
  await linkTrialPapers({ ids: ["NCT99996001", "NCT99996002"] });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM trial_publications WHERE nct_id LIKE 'NCT9999600%'")).rows[0].n, 1);
});

test("drug papers: newest papers and the total count; only new papers are downloaded", async () => {
  const xml = (ids: string[]) => `<PubmedArticleSet>${ids.map((id) => article(id, { title: `Paper ${id}`, types: ["Journal Article"] })).join("")}</PubmedArticleSet>`;
  const calls = stubPubmed(() => ({ count: 1234, ids: ["39000001", "39000004"] }), xml);
  const r = await linkDrugPapers({ slugs: ["zzpubmedtide"] });
  assert.equal(r.drugsChecked, 1);
  assert.equal(r.newPapers, 1); // 39000001 was already stored
  assert.ok(calls.some((c) => c === "efetch.fcgi 39000004"));
  const p = (await pool.query("SELECT pubmed_count, pubmed_query FROM products WHERE slug = 'zzpubmedtide'")).rows[0];
  assert.deepEqual(p, { pubmed_count: 1234, pubmed_query: '"Zzpubmedtide"[tiab]' });
  const pp = (await pool.query("SELECT pmid FROM product_publications WHERE product_slug = 'zzpubmedtide' ORDER BY 1")).rows.map((x) => x.pmid);
  assert.deepEqual(pp, ["39000001", "39000004"]);
});
