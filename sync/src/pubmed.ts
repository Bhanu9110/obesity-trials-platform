// PubMed papers for trials and drugs (NCBI E-utilities).
//
//   Trials: papers that cite the trial's NCT ID — as a PubMed "secondary ID" (the registry
//           number PubMed attaches to trial papers) or in the title / abstract. Each paper is
//           marked as a RESULTS paper when it is a clinical-trial report and not a protocol,
//           design or baseline paper.
//   Drugs:  the newest papers naming the drug, its INN, brand or code names (any topic), and
//           the total number found on PubMed.
//
// Title, journal, date, authors, DOI, publication types and the abstract are stored
// (db/migrations/0027_pubmed.sql). Every trial and drug is re-checked every PUBMED_RECHECK_DAYS.
//
// The optional secret NCBI_API_KEY raises NCBI's limit from 3 to 10 requests a second. It is
// only read from the environment (GitHub Actions secret) — never stored in the repository.
// A PubMed problem never fails the daily sync.

import { pool, withTransaction } from "./db.js";

const BASE = process.env.PUBMED_BASE_URL ?? "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export const pubmedConfig = {
  apiKey: (process.env.NCBI_API_KEY ?? "").trim(),
  recheckDays: Number(process.env.PUBMED_RECHECK_DAYS ?? 7),
  maxTrials: Number(process.env.PUBMED_MAX_TRIALS ?? 4000),
  maxDrugs: Number(process.env.PUBMED_MAX_DRUGS ?? 200),
  /** newest papers kept per drug (the total count is kept too) */
  drugPapers: Number(process.env.PUBMED_DRUG_PAPERS ?? 100),
  budgetMin: Number(process.env.PUBMED_BUDGET_MIN ?? 15),
  timeoutMs: Number(process.env.PUBMED_TIMEOUT_MS ?? 30000),
};

const TOOL = "obesity-trials-platform";
const delayMs = () => (pubmedConfig.apiKey ? 120 : 380); // NCBI: 10/s with a key, 3/s without
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// --------------------------------------------------------------------------- #
// HTTP
// --------------------------------------------------------------------------- #
let lastCall = 0;

/** POST to an E-utility (long search terms and ID lists fit in the body). */
export async function eutil(name: "esearch" | "efetch", params: Record<string, string>, attempts = 4): Promise<string> {
  const body = new URLSearchParams({ db: "pubmed", tool: TOOL, ...params });
  if (pubmedConfig.apiKey) body.set("api_key", pubmedConfig.apiKey);
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    const wait = lastCall + delayMs() - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch(`${BASE}/${name}.fcgi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": `${TOOL}/1.0 (+https://obesity-trials.vercel.app)` },
        body,
        signal: AbortSignal.timeout(pubmedConfig.timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`PubMed HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`PubMed HTTP ${res.status}`), { fatal: true });
      return await res.text();
    } catch (e) {
      err = e;
      if ((e as any)?.fatal) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw err;
}

export async function esearch(term: string, retmax: number, sort?: "pub_date"): Promise<{ count: number; ids: string[] }> {
  const txt = await eutil("esearch", { term, retmax: String(retmax), retmode: "json", ...(sort ? { sort } : {}) });
  const j = JSON.parse(txt);
  if (j?.esearchresult?.ERROR) throw new Error(`PubMed search error: ${j.esearchresult.ERROR}`);
  return { count: Number(j?.esearchresult?.count ?? 0), ids: (j?.esearchresult?.idlist ?? []).map(String) };
}

export async function efetch(pmids: string[]): Promise<PubmedArticle[]> {
  const out: PubmedArticle[] = [];
  for (const group of chunks(pmids, 200)) {
    out.push(...parsePubmedXml(await eutil("efetch", { id: group.join(","), retmode: "xml" })));
  }
  return out;
}

// --------------------------------------------------------------------------- #
// PubMed XML (efetch) — the few fields we keep
// --------------------------------------------------------------------------- #
export interface PubmedArticle {
  pmid: string;
  title: string;
  journal: string | null;
  pub_date: string | null;
  pub_year: number | null;
  authors: string | null;
  doi: string | null;
  pub_types: string[];
  abstract: string | null;
  /** NCT IDs PubMed lists as secondary IDs (DataBankList) */
  accession_ncts: string[];
  /** NCT IDs written in the title or abstract */
  text_ncts: string[];
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
const first = (s: string, re: RegExp) => { const m = s.match(re); return m ? decode(m[1]) : null; };
const all = (s: string, re: RegExp) => [...s.matchAll(re)].map((m) => decode(m[1]));
const MONTHS: Record<string, string> = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };
const NCT_RE = /\bNCT\s?(\d{8})\b/gi;

export function parsePubmedXml(xml: string): PubmedArticle[] {
  const out: PubmedArticle[] = [];
  for (const m of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)) {
    // the paper's own data — not the reference list at the end
    const a = m[1].split(/<ReferenceList/)[0];
    const pmid = first(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    if (!pmid) continue;
    const title = first(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || first(a, /<VernacularTitle[^>]*>([\s\S]*?)<\/VernacularTitle>/) || "(no title)";
    const journal = first(a, /<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/) ?? first(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/);
    const pd = a.match(/<PubDate>([\s\S]*?)<\/PubDate>/)?.[1] ?? "";
    let year = first(pd, /<Year>(\d{4})<\/Year>/);
    let month = first(pd, /<Month>([^<]+)<\/Month>/);
    const day = first(pd, /<Day>(\d+)<\/Day>/);
    const medline = first(pd, /<MedlineDate>([^<]+)<\/MedlineDate>/);
    if (month && MONTHS[month.padStart(2, "0")]) month = MONTHS[month.padStart(2, "0")];
    if (!year && medline) year = medline.match(/\d{4}/)?.[0] ?? null;
    const pub_date = year ? [year, month, day].filter(Boolean).join(" ") : medline;
    const names = [...a.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)].map((x) => {
      const last = first(x[1], /<LastName>([\s\S]*?)<\/LastName>/);
      const ini = first(x[1], /<Initials>([\s\S]*?)<\/Initials>/);
      return last ? `${last}${ini ? " " + ini : ""}` : first(x[1], /<CollectiveName>([\s\S]*?)<\/CollectiveName>/);
    }).filter((x): x is string => !!x);
    const authors = names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ", et al." : "") : null;
    const doi = first(a, /<ELocationID[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/) ?? first(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    const pub_types = [...new Set(all(a, /<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g))];
    const absBlock = a.match(/<Abstract>([\s\S]*?)<\/Abstract>/)?.[1] ?? "";
    const parts = [...absBlock.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((x) => {
      const label = x[1].match(/Label="([^"]+)"/)?.[1];
      const text = decode(x[2]);
      return label && text ? `${decode(label)}: ${text}` : text;
    }).filter(Boolean);
    const abstract = parts.length ? parts.join("\n").slice(0, 20000) : null;
    const accession_ncts = [...new Set(all(a, /<AccessionNumber>([\s\S]*?)<\/AccessionNumber>/g)
      .map((x) => x.toUpperCase().replace(/\s/g, "")).filter((x) => /^NCT\d{8}$/.test(x)))];
    const text_ncts = [...new Set([...`${title} ${abstract ?? ""}`.matchAll(NCT_RE)].map((x) => `NCT${x[1]}`))];
    out.push({ pmid, title, journal, pub_date, pub_year: year ? Number(year) : null, authors, doi, pub_types, abstract, accession_ncts, text_ncts });
  }
  return out;
}

/**
 * Does the paper report the trial's results? A clinical-trial / RCT report (or a
 * secondary / post-hoc analysis of one) — not a protocol, design, rationale or
 * baseline paper, review, editorial, comment or letter.
 */
export function isResultsPaper(p: Pick<PubmedArticle, "title" | "pub_types">): boolean {
  const t = p.pub_types.join("|");
  if (/Clinical Trial Protocol|Review|Editorial|Comment|Letter|News|Published Erratum|Retracted Publication/i.test(t)) return false;
  if (/\b(protocol|design|rationale|baseline characteristics|methodolog\w*|statistical analysis plan)\b/i.test(p.title)) return false;
  return /Clinical Trial|Randomized Controlled Trial|Clinical Study|Equivalence Trial|Pragmatic Clinical Trial|Observational Study|Multicenter Study/i.test(t);
}

// --------------------------------------------------------------------------- #
// Drug search term
// --------------------------------------------------------------------------- #
const GENERIC = new Set(["placebo", "injection", "tablet", "tablets", "capsule", "oral", "solution", "drug", "dose", "standard of care"]);

/** One PubMed search for a drug: its names as title/abstract phrases, OR'd. Combinations ("A + B") need both. */
export function drugTerm(names: string[], max = 20): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of names) {
    const n = raw.replace(/[®™"]/g, "").replace(/\s+/g, " ").trim();
    if (!n || /^undisclosed/i.test(n)) continue;
    const key = n.toLowerCase();
    if (seen.has(key) || GENERIC.has(key)) continue;
    // too short / no letters: would match unrelated papers
    if (n.replace(/[^a-z0-9]/gi, "").length < 4 || !/[a-z]/i.test(n)) continue;
    seen.add(key);
    const combo = n.split(/\s*\+\s*|\s+and\s+|\s*\/\s*(?=[a-z])/i).map((x) => x.trim()).filter(Boolean);
    if (combo.length > 1) {
      if (combo.some((x) => x.replace(/[^a-z0-9]/gi, "").length < 4)) continue;
      parts.push(`(${combo.map((x) => `"${x}"[tiab]`).join(" AND ")})`);
    } else {
      parts.push(`"${n}"[tiab]`);
    }
    if (parts.length >= max) break;
  }
  return parts.length ? parts.join(" OR ") : null;
}

// --------------------------------------------------------------------------- #
// Database
// --------------------------------------------------------------------------- #
async function savePublications(c: { query: typeof pool.query }, papers: PubmedArticle[]) {
  for (const group of chunks(papers, 200)) {
    await c.query(
      `INSERT INTO publications (pmid, title, journal, pub_date, pub_year, authors, doi, pub_types, abstract, fetched_at)
       SELECT x.pmid, x.title, x.journal, x.pub_date, x.pub_year, x.authors, x.doi, x.pub_types, x.abstract, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(pmid text, title text, journal text, pub_date text, pub_year int,
              authors text, doi text, pub_types text[], abstract text)
       ON CONFLICT (pmid) DO UPDATE SET title = EXCLUDED.title, journal = EXCLUDED.journal, pub_date = EXCLUDED.pub_date,
         pub_year = EXCLUDED.pub_year, authors = EXCLUDED.authors, doi = EXCLUDED.doi, pub_types = EXCLUDED.pub_types,
         abstract = EXCLUDED.abstract, fetched_at = now()`,
      [JSON.stringify(group)],
    );
  }
}

export interface PubmedResult {
  trialsChecked: number;
  trialPapers: number;
  resultsPapers: number;
  drugsChecked: number;
  drugPapers: number;
  newPapers: number;
  stoppedEarly: boolean;
  error?: string;
}

/** Trials: papers citing their NCT IDs. */
export async function linkTrialPapers(opts: { log?: (m: string, o?: unknown) => void; deadline?: number; ids?: string[] } = {}): Promise<Pick<PubmedResult, "trialsChecked" | "trialPapers" | "resultsPapers" | "newPapers" | "stoppedEarly">> {
  const out = { trialsChecked: 0, trialPapers: 0, resultsPapers: 0, newPapers: 0, stoppedEarly: false };
  const ids = opts.ids ?? (await pool.query<{ nct_id: string }>(
    `SELECT nct_id FROM trials
      WHERE pubmed_checked_at IS NULL OR pubmed_checked_at < now() - make_interval(days => $1)
      ORDER BY pubmed_checked_at NULLS FIRST, nct_id LIMIT $2`,
    [pubmedConfig.recheckDays, pubmedConfig.maxTrials],
  )).rows.map((r) => r.nct_id);
  for (const batch of chunks(ids, 80)) {
    if (opts.deadline && Date.now() > opts.deadline) { out.stoppedEarly = true; break; }
    const set = new Set(batch);
    const term = batch.map((id) => `${id}[si] OR ${id}[tiab]`).join(" OR ");
    const found = await esearch(term, 5000);
    const papers = found.ids.length ? await efetch(found.ids) : [];
    const known = new Set((await pool.query<{ pmid: string }>("SELECT pmid FROM publications WHERE pmid = ANY($1)", [found.ids])).rows.map((r) => r.pmid));
    const links: { nct_id: string; pmid: string; is_results: boolean; found_by: string }[] = [];
    for (const p of papers) {
      const res = isResultsPaper(p);
      for (const id of new Set([...p.accession_ncts, ...p.text_ncts])) {
        if (!set.has(id)) continue;
        links.push({ nct_id: id, pmid: p.pmid, is_results: res, found_by: p.accession_ncts.includes(id) ? "secondary_id" : "abstract" });
      }
    }
    const linked = papers.filter((p) => links.some((l) => l.pmid === p.pmid));
    await withTransaction(async (c) => {
      await savePublications(c, linked);
      await c.query("DELETE FROM trial_publications WHERE nct_id = ANY($1)", [batch]);
      if (links.length) {
        await c.query(
          `INSERT INTO trial_publications (nct_id, pmid, is_results, found_by)
           SELECT x.nct_id, x.pmid, x.is_results, x.found_by FROM jsonb_to_recordset($1::jsonb)
                  AS x(nct_id text, pmid text, is_results boolean, found_by text)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(links)],
        );
      }
      await c.query("UPDATE trials SET pubmed_checked_at = now() WHERE nct_id = ANY($1)", [batch]);
    });
    out.trialsChecked += batch.length;
    out.trialPapers += links.length;
    out.resultsPapers += links.filter((l) => l.is_results).length;
    out.newPapers += linked.filter((p) => !known.has(p.pmid)).length;
  }
  opts.log?.("PubMed: trial papers", out);
  return out;
}

/** Drugs: the newest papers naming them, and how many there are. */
export async function linkDrugPapers(opts: { log?: (m: string, o?: unknown) => void; deadline?: number; slugs?: string[] } = {}): Promise<Pick<PubmedResult, "drugsChecked" | "drugPapers" | "newPapers" | "stoppedEarly">> {
  const out = { drugsChecked: 0, drugPapers: 0, newPapers: 0, stoppedEarly: false };
  const rows = (await pool.query<{ slug: string; names: string[] }>(
    `SELECT p.slug,
            array_remove(ARRAY[p.name] || coalesce(regexp_split_to_array(concat_ws(',',
              to_jsonb(p) ->> 'inn', to_jsonb(p) #>> '{curated_info,inn,value}', to_jsonb(p) #>> '{auto_info,inn,value}',
              to_jsonb(p) ->> 'brand_names', to_jsonb(p) #>> '{curated_info,brand_names,value}', to_jsonb(p) #>> '{auto_info,brand_names,value}',
              to_jsonb(p) ->> 'aliases', to_jsonb(p) #>> '{curated_info,aliases,value}', to_jsonb(p) #>> '{auto_info,aliases,value}'),
              '\\s*[,;]\\s*'), '{}'), '') AS names
       FROM products p
      WHERE p.kind IS NULL AND p.slug NOT LIKE 'undisclosed%'
        AND ($3::text[] IS NULL OR p.slug = ANY($3))
        AND ($3::text[] IS NOT NULL OR p.pubmed_checked_at IS NULL OR p.pubmed_checked_at < now() - make_interval(days => $1))
        AND (EXISTS (SELECT 1 FROM trial_products tp WHERE tp.product_id = p.id)
             OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug))
      ORDER BY p.pubmed_checked_at NULLS FIRST, p.slug
      LIMIT $2`,
    [pubmedConfig.recheckDays, pubmedConfig.maxDrugs, opts.slugs ?? null],
  )).rows;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) { out.stoppedEarly = true; break; }
    const term = drugTerm(r.names);
    if (!term) {
      await pool.query("UPDATE products SET pubmed_checked_at = now(), pubmed_count = 0, pubmed_query = NULL WHERE slug = $1", [r.slug]);
      continue;
    }
    const found = await esearch(term, pubmedConfig.drugPapers, "pub_date");
    const known = new Set((await pool.query<{ pmid: string }>("SELECT pmid FROM publications WHERE pmid = ANY($1)", [found.ids])).rows.map((x) => x.pmid));
    const fresh = found.ids.filter((id) => !known.has(id));
    const papers = fresh.length ? await efetch(fresh) : [];
    const got = new Set([...known, ...papers.map((p) => p.pmid)]);
    await withTransaction(async (c) => {
      await savePublications(c, papers);
      await c.query("DELETE FROM product_publications WHERE product_slug = $1", [r.slug]);
      await c.query(
        "INSERT INTO product_publications (product_slug, pmid) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
        [r.slug, found.ids.filter((id) => got.has(id))],
      );
      await c.query("UPDATE products SET pubmed_checked_at = now(), pubmed_count = $2, pubmed_query = $3 WHERE slug = $1", [r.slug, found.count, term]);
    });
    out.drugsChecked += 1;
    out.drugPapers += got.size;
    out.newPapers += papers.length;
  }
  opts.log?.("PubMed: drug papers", out);
  return out;
}

/** Papers no trial or drug points to any more (trial removed, drug merged). */
export async function pruneUnlinkedPapers(): Promise<number> {
  await pool.query("DELETE FROM trial_publications tp WHERE NOT EXISTS (SELECT 1 FROM trials t WHERE t.nct_id = tp.nct_id)");
  await pool.query("DELETE FROM product_publications pp WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = pp.product_slug)");
  const r = await pool.query(
    `DELETE FROM publications pu WHERE NOT EXISTS (SELECT 1 FROM trial_publications tp WHERE tp.pmid = pu.pmid)
                                   AND NOT EXISTS (SELECT 1 FROM product_publications pp WHERE pp.pmid = pu.pmid)`,
  );
  return r.rowCount ?? 0;
}

/** The daily PubMed step: trials first, then drugs, within the time budget. */
export async function syncPubmed(opts: { log?: (m: string, o?: unknown) => void } = {}): Promise<PubmedResult> {
  const deadline = Date.now() + pubmedConfig.budgetMin * 60_000;
  const res: PubmedResult = { trialsChecked: 0, trialPapers: 0, resultsPapers: 0, drugsChecked: 0, drugPapers: 0, newPapers: 0, stoppedEarly: false };
  opts.log?.(`PubMed: ${pubmedConfig.apiKey ? "with" : "without"} an NCBI API key`);
  try {
    const t = await linkTrialPapers({ log: opts.log, deadline });
    Object.assign(res, t);
    const d = await linkDrugPapers({ log: opts.log, deadline });
    res.drugsChecked = d.drugsChecked;
    res.drugPapers = d.drugPapers;
    res.newPapers += d.newPapers;
    res.stoppedEarly = t.stoppedEarly || d.stoppedEarly;
    await pruneUnlinkedPapers();
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
  }
  return res;
}
