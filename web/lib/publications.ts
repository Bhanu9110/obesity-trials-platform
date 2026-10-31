// PubMed papers (filled by the daily sync — sync/src/pubmed.ts, migration 0027).
// Every reader returns nothing (instead of failing) while migration 0027 is not applied yet.

import { query } from "@/lib/db";

export interface Publication {
  pmid: string;
  title: string;
  journal: string | null;
  pub_date: string | null;
  pub_year: number | null;
  authors: string | null;
  doi: string | null;
  pub_types: string[];
  abstract: string | null;
  /** trial papers only: reports the trial's results */
  is_results?: boolean;
  /** trial papers only: how the link was found */
  found_by?: string;
}

export interface DrugPublications {
  total: number | null;
  query: string | null;
  checkedAt: string | null;
  papers: Publication[];
}

export const pubmedUrl = (pmid: string) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
export const pubmedSearchUrl = (term: string) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}&sort=date`;
export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

const COLS = "pu.pmid, pu.title, pu.journal, pu.pub_date, pu.pub_year, pu.authors, pu.doi, pu.pub_types, pu.abstract";

let ready: boolean | null = null;
let checkedAt = 0;
/** Is migration 0027 applied? (checked at most once a minute) */
export async function pubmedReady(): Promise<boolean> {
  if (ready && Date.now() - checkedAt < 3_600_000) return true;
  if (ready === false && Date.now() - checkedAt < 60_000) return false;
  try {
    const r = await query<{ ok: boolean }>("SELECT to_regclass('public.trial_publications') IS NOT NULL AS ok");
    ready = Boolean(r[0]?.ok);
  } catch {
    ready = false;
  }
  checkedAt = Date.now();
  return ready;
}

/** Papers citing a trial — results papers first, then newest. */
export async function trialPublications(nct: string): Promise<Publication[]> {
  if (!(await pubmedReady())) return [];
  return query<Publication>(
    `SELECT ${COLS}, tp.is_results, tp.found_by
       FROM trial_publications tp JOIN publications pu ON pu.pmid = tp.pmid
      WHERE tp.nct_id = $1
      ORDER BY tp.is_results DESC, pu.pub_year DESC NULLS LAST, pu.pmid DESC`,
    [nct],
  );
}

/** The newest papers naming a drug, and how many PubMed has in total. */
export async function drugPublications(slug: string): Promise<DrugPublications> {
  const empty = { total: null, query: null, checkedAt: null, papers: [] };
  if (!(await pubmedReady())) return empty;
  const [meta, papers] = await Promise.all([
    query<{ total: number | null; query: string | null; checked_at: string | null }>(
      `SELECT pubmed_count AS total, pubmed_query AS query, to_char(pubmed_checked_at, 'YYYY-MM-DD') AS checked_at
         FROM products WHERE slug = $1`,
      [slug],
    ),
    query<Publication>(
      `SELECT ${COLS} FROM product_publications pp JOIN publications pu ON pu.pmid = pp.pmid
        WHERE pp.product_slug = $1
        ORDER BY pu.pub_year DESC NULLS LAST, pu.pmid::bigint DESC`,
      [slug],
    ),
  ]);
  return { total: meta[0]?.total ?? null, query: meta[0]?.query ?? null, checkedAt: meta[0]?.checked_at ?? null, papers };
}

/** Results papers per trial (PMIDs, newest first) — for drug trial tables and exports. */
export async function resultsPapers(ncts: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ncts.length || !(await pubmedReady())) return out;
  const rows = await query<{ nct_id: string; pmids: string[] }>(
    `SELECT tp.nct_id, array_agg(tp.pmid ORDER BY pu.pub_year DESC NULLS LAST, tp.pmid DESC) AS pmids
       FROM trial_publications tp JOIN publications pu ON pu.pmid = tp.pmid
      WHERE tp.is_results AND tp.nct_id = ANY($1)
      GROUP BY tp.nct_id`,
    [ncts],
  );
  for (const r of rows) out.set(r.nct_id, r.pmids);
  return out;
}

/** Papers on PubMed per drug (total count) — for exports. */
export async function drugPaperCounts(slugs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!slugs.length || !(await pubmedReady())) return out;
  const rows = await query<{ slug: string; n: number | null }>(
    "SELECT slug, pubmed_count AS n FROM products WHERE slug = ANY($1) AND pubmed_count IS NOT NULL", [slugs],
  );
  for (const r of rows) if (r.n != null) out.set(r.slug, r.n);
  return out;
}
