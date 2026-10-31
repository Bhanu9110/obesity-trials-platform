import { doiUrl, pubmedSearchUrl, pubmedUrl, type Publication } from "@/lib/publications";

// PubMed papers on the trial and drug pages (no client JavaScript: abstracts open with <details>).

/** Short labels for the publication types worth showing. */
function typeTags(types: string[]): string[] {
  const t = types.join("|");
  const out: string[] = [];
  const phase = t.match(/Clinical Trial, Phase (I{1,3}V?|IV)\b/)?.[1];
  if (/Randomized Controlled Trial/.test(t)) out.push("RCT");
  if (phase) out.push(`Phase ${({ I: "1", II: "2", III: "3", IV: "4" } as Record<string, string>)[phase] ?? phase}`);
  else if (/Clinical Trial(?! Protocol)/.test(t) && !out.length) out.push("Clinical trial");
  if (/Meta-Analysis/.test(t)) out.push("Meta-analysis");
  if (/Systematic Review/.test(t)) out.push("Systematic review");
  else if (/\bReview\b/.test(t)) out.push("Review");
  if (/Clinical Trial Protocol/.test(t)) out.push("Protocol");
  if (/Observational Study/.test(t)) out.push("Observational");
  if (/Case Reports/.test(t)) out.push("Case report");
  if (/Editorial|Comment|Letter/.test(t)) out.push("Comment");
  return out;
}

function PaperItem({ p }: { p: Publication }) {
  const tags = typeTags(p.pub_types);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <a href={pubmedUrl(p.pmid)} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug text-brand-700 hover:underline">
          {p.title}
        </a>
        {p.is_results && (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Results paper</span>
        )}
        {tags.map((t) => (
          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{t}</span>
        ))}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {[p.authors, p.journal ? <i key="j">{p.journal}</i> : null, p.pub_date].filter(Boolean).map((x, i) => (
          <span key={i}>{i > 0 && " · "}{x}</span>
        ))}
        <span> · PMID <a href={pubmedUrl(p.pmid)} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{p.pmid}</a></span>
        {p.doi && <span> · <a href={doiUrl(p.doi)} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">DOI</a></span>}
        {p.found_by === "abstract" && <span title="The NCT ID is written in the abstract (PubMed has not listed it as the paper's registry number)"> · NCT ID in abstract</span>}
      </div>
      {p.abstract && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-800">
            <span className="group-open:hidden">Show abstract</span><span className="hidden group-open:inline">Hide abstract</span>
          </summary>
          <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">
            {p.abstract.split("\n").map((para, i) => {
              const m = para.match(/^([A-Z][A-Z ,/&-]{2,40}):\s(.*)$/);
              return <p key={i}>{m ? <><span className="font-semibold text-slate-800">{m[1].charAt(0) + m[1].slice(1).toLowerCase()}:</span> {m[2]}</> : para}</p>;
            })}
          </div>
        </details>
      )}
    </li>
  );
}

/** Trial page: papers citing the trial's NCT ID. */
export function TrialPublications({ papers, nct }: { papers: Publication[]; nct: string }) {
  if (!papers.length) return null;
  const results = papers.filter((p) => p.is_results).length;
  return (
    <section id="publications" className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-display text-[15px] font-semibold text-slate-950">Publications</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        {papers.length} {papers.length === 1 ? "paper" : "papers"} on PubMed citing {nct}
        {results ? ` — ${results} reporting results` : ""}. Updated weekly.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">{papers.map((p) => <PaperItem key={p.pmid} p={p} />)}</ul>
    </section>
  );
}

const FIRST = 10;

/** Drug page: the newest papers naming the drug. */
export function DrugPublications({ papers, total, query, checkedAt, name }: {
  papers: Publication[]; total: number | null; query: string | null; checkedAt: string | null; name: string;
}) {
  if (!papers.length) return null;
  const rest = papers.slice(FIRST);
  return (
    <section id="publications" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-slate-950">Publications on PubMed</h2>
        {query && (
          <a href={pubmedSearchUrl(query)} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
            See all{total != null ? ` ${total.toLocaleString("en-US")}` : ""} on PubMed →
          </a>
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {total != null ? `${total.toLocaleString("en-US")} ${total === 1 ? "paper names" : "papers name"}` : "Papers naming"} {name} or its other names (all topics).
        {" "}The newest {papers.length} are listed{checkedAt ? `; checked ${checkedAt}` : ""}.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">{papers.slice(0, FIRST).map((p) => <PaperItem key={p.pmid} p={p} />)}</ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none border-t border-slate-100 pt-3 text-sm font-medium text-brand-600 hover:text-brand-700">
            <span className="group-open:hidden">Show {rest.length} more</span><span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="divide-y divide-slate-100">{rest.map((p) => <PaperItem key={p.pmid} p={p} />)}</ul>
        </details>
      )}
    </section>
  );
}
