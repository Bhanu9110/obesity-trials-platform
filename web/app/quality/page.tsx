import Link from "next/link";
import { qualityOverview, qualityTrials } from "@/lib/queries";
import { Dash, NctLink, PhaseText } from "@/components/ui";

export const dynamic = "force-dynamic";

// Plain-language names for the issue codes produced by sync/src/quality.ts.
const LABELS: Record<string, string> = {
  MISSING_SPONSOR: "No lead sponsor",
  NO_CONDITIONS: "No indication listed",
  MISSING_PHASE: "No phase",
  PHASE_NOT_APPLICABLE: "Phase 'Not applicable'",
  NO_DRUG_INTERVENTION: "No drug intervention",
  NO_DRUG_PRODUCT: "Drug not recognised",
  UNMATCHED_INTERVENTION: "Some interventions not matched",
  NO_LOCATION: "No site countries",
  UNKNOWN_COUNTRY: "Country without continent",
  MISSING_SOURCE_UPDATED_AT: "No CT.gov update date",
  VALIDATION_WARNING: "Values cleaned on import",
};
const SEV_STYLE: Record<string, string> = {
  error: "bg-rose-100 text-rose-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-slate-100 text-slate-600",
};

function Tile({ label, value, sub, tone = "text-slate-900" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const code = sp.code && /^[A-Z_]+$/.test(sp.code) ? sp.code : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [o, list] = await Promise.all([qualityOverview(), qualityTrials(code, page)]);
  const pct = (n: number) => (o.checked ? `${Math.round((n / o.checked) * 100)}%` : "—");
  const pages = Math.max(1, Math.ceil(list.total / 50));
  const href = (c?: string, p = 1) => {
    const q = new URLSearchParams();
    if (c) q.set("code", c);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/quality${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Data quality</h1>
        <p className="text-sm text-slate-500">
          Every trial is checked automatically each time it is synced. Score 1.00 = no issues.
          Covers the primary-obesity trials shown on the website.
        </p>
      </div>

      {o.checked === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No quality results yet. They appear after the next sync (the first sync after an upgrade
          fills them in for every trial).
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Average score" value={o.avgScore != null ? o.avgScore.toFixed(2) : "—"} sub={`${o.checked.toLocaleString()} trials checked`} />
          <Tile label="Clean (1.00)" value={o.clean.toLocaleString()} sub={pct(o.clean)} tone="text-emerald-600" />
          <Tile label="Minor (0.90–0.99)" value={o.minor.toLocaleString()} sub={pct(o.minor)} tone="text-sky-600" />
          <Tile label="Review (0.75–0.89)" value={o.needsReview.toLocaleString()} sub={pct(o.needsReview)} tone="text-amber-600" />
          <Tile label="Poor (< 0.75)" value={o.poor.toLocaleString()} sub={pct(o.poor)} tone="text-rose-600" />
        </div>
      )}

      {o.totalTrials > 0 && o.withLineage < o.totalTrials && (
        <p className="text-xs text-slate-500">
          {(o.totalTrials - o.withLineage).toLocaleString()} of {o.totalTrials.toLocaleString()} trials have no source
          record yet, so they have no quality check — they are filled in by the next full sync.
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Issues found</h2>
        {o.issues.length === 0 ? (
          <p className="text-sm text-emerald-600">No issues found.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link
              href={href()}
              className={`rounded-full border px-3 py-1 text-xs ${!code ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              All issues
            </Link>
            {o.issues.map((i) => (
              <Link
                key={i.code}
                href={href(i.code)}
                title={i.code}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${code === i.code ? "border-brand-600 ring-2 ring-brand-100" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[i.severity] ?? ""}`}>{i.severity}</span>
                <span className="text-slate-700">{LABELS[i.code] ?? i.code}</span>
                <span className="font-semibold tabular-nums text-slate-900">{i.trials.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
          {code ? `Trials with “${LABELS[code] ?? code}”` : "Trials with issues"} ({list.total.toLocaleString()})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Trial ID</th>
                <th className="px-5 py-2.5 font-semibold">Score</th>
                <th className="px-5 py-2.5 font-semibold">Issues</th>
                <th className="px-5 py-2.5 font-semibold">Phase</th>
                <th className="px-5 py-2.5 font-semibold">Sponsor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No trials.</td></tr>
              ) : (
                list.items.map((t) => (
                  <tr key={t.nct_id} className="align-top hover:bg-slate-50">
                    <td className="px-5 py-2.5"><NctLink id={t.nct_id} /></td>
                    <td className="px-5 py-2.5 tabular-nums text-slate-700">{t.score.toFixed(2)}</td>
                    <td className="px-5 py-2.5">
                      <ul className="space-y-1">
                        {t.issues.map((i) => (
                          <li key={i.code} className="text-xs">
                            <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[i.severity] ?? ""}`}>{i.severity}</span>
                            <span className="text-slate-700">{LABELS[i.code] ?? i.message}</span>
                            {i.detail?.length ? <span className="text-slate-400"> — {i.detail.slice(0, 3).join(", ")}{i.detail.length > 3 ? "…" : ""}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-5 py-2.5 text-slate-700"><PhaseText phase={t.phase} /></td>
                    <td className="px-5 py-2.5 text-slate-700">{t.sponsor || <Dash />}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-slate-100 py-3 text-sm">
            {page > 1 ? <Link href={href(code, page - 1)} className="rounded-md border border-slate-300 px-3 py-1.5">Prev</Link> : <span className="px-3 py-1.5 text-slate-300">Prev</span>}
            <span className="text-slate-500">Page {page} of {pages}</span>
            {page < pages ? <Link href={href(code, page + 1)} className="rounded-md border border-slate-300 px-3 py-1.5">Next</Link> : <span className="px-3 py-1.5 text-slate-300">Next</span>}
          </div>
        )}
      </section>
    </div>
  );
}
