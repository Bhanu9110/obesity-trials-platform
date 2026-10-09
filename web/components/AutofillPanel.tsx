import Link from "next/link";
import type { AutofillOverview } from "@/lib/queries";

// Quality page: how the automatic drug profiles are doing — last run, each source's health,
// how full each profile field is (and from where), and what was left out of the drug list.

const FIELD_LABEL: Record<string, string> = {
  candidate: "Candidate (pipeline)", sponsor: "Company", phase: "Phase", indication: "Indication",
  drug_class: "Therapy class", therapy_subclass: "Therapy subclass", moa: "Mechanism (MOA)", modality: "Modality",
  roa: "Route (ROA)", aliases: "Alias (code names)", brand_names: "Brand name", approved: "Approved",
  approval_date: "Approval date", parent_drug: "Similar / parent drug",
};
const SOURCE_ORDER = ["Trials", "openFDA", "ChEMBL", "Inxight Drugs", "Company pipelines", "Conference abstracts", "Name rules"];

const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

export default function AutofillPanel({ o }: { o: AutofillOverview }) {
  const sources = ["openFDA", "ChEMBL", "Inxight Drugs"];
  const pct = (n: number) => (o.drugs ? Math.round((n / o.drugs) * 100) : 0);
  return (
    <section id="autofill" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Drug profile auto-fill</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {o.drugs.toLocaleString()} drugs in the drug list. Blank profile fields are filled every night from trials and
            the sources below; a value typed in on a drug page always wins.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          Last run: <b className="text-slate-800">{ago(o.last?.at)}</b>
          {o.last && <> · {o.last.minutes} min{o.last.stoppedEarly ? " · stopped at the time limit (continues next run)" : ""}</>}
        </div>
      </div>

      {/* Sources */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {sources.map((name) => {
          const s = o.sources[name];
          const run = o.last?.[name as "openFDA" | "ChEMBL" | "Inxight Drugs"];
          const state = !s ? "unknown" : s.skipped ? "skipped" : s.ok ? "ok" : s.failingSince && Date.now() - Date.parse(s.failingSince) >= 47 * 3600_000 ? "down" : "warn";
          const tone = {
            ok: "border-emerald-200 bg-emerald-50/60 text-emerald-800",
            warn: "border-amber-200 bg-amber-50 text-amber-800",
            down: "border-rose-200 bg-rose-50 text-rose-800",
            skipped: "border-slate-200 bg-slate-50 text-slate-600",
            unknown: "border-slate-200 bg-slate-50 text-slate-500",
          }[state];
          const label = { ok: "Working", warn: "Failed last run", down: "Down 3+ days", skipped: "Left out", unknown: "Not checked yet" }[state];
          return (
            <div key={name} className={`rounded-xl border p-3 text-xs ${tone}`} title={s?.detail}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{name}</span>
                <span className="font-semibold">{label}</span>
              </div>
              <div className="mt-1 opacity-90">
                {s && !s.ok && !s.skipped && <>since {day(s.failingSince)}{s.lastOkAt ? `, last worked ${day(s.lastOkAt)}` : ""} — {s.detail.slice(0, 90)}</>}
                {s?.ok && !s.skipped && <>checked {ago(s.checkedAt)}</>}
                {s?.skipped && <>ENRICH_SKIP_SOURCES</>}
              </div>
              {run && <div className="mt-1 opacity-75">last run: {run.checked.toLocaleString()} drugs checked, {run.found.toLocaleString()} found</div>}
            </div>
          );
        })}
      </div>
      {!!o.last?.sourcesDown?.length && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
          {o.last.sourcesDown.slice(0, 6).map((d, i) => <li key={i}>{d.slice(0, 220)}</li>)}
        </ul>
      )}

      {/* Coverage */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-semibold">Field</th>
              <th className="w-[38%] py-2 pr-3 font-semibold">Filled <span className="normal-case tracking-normal text-slate-400">(dark = typed in, light = automatic)</span></th>
              <th className="py-2 font-semibold">Automatic values from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {o.coverage.map((c) => {
              const filled = c.manual + c.auto;
              const groups = Object.entries(c.sources).sort((a, b) => SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]));
              return (
                <tr key={c.field}>
                  <td className="py-2 pr-3 text-slate-800">{FIELD_LABEL[c.field] ?? c.field}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-brand-600" style={{ width: `${pct(c.manual)}%` }} />
                        <div className="h-full bg-brand-500/40" style={{ width: `${pct(c.auto)}%` }} />
                      </div>
                      <span className="w-20 text-right text-xs tabular-nums text-slate-600" title={`${c.manual} typed in, ${c.auto} automatic`}>
                        {pct(filled)}% · {filled.toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {groups.length === 0 ? <span className="text-xs text-slate-300">—</span> : groups.map(([g, n]) => (
                        <span key={g} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                          {g} <b className="tabular-nums text-slate-800">{n.toLocaleString()}</b>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Left out of the drug list */}
      <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
        <summary className="cursor-pointer text-slate-700">
          Left out of the drug list: <b>{o.hidden.not_drug.toLocaleString()}</b> not drugs (diets, procedures, tests…) and{" "}
          <b>{o.hidden.supplement.toLocaleString()}</b> supplements
          {o.review.length > 0 && <> · <span className="text-amber-700">{o.review.length} hidden by a name rule — worth a look</span></>}
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          They stay in the database (their trials still name them) but are not shown as drugs or counted. The reviewed
          list is in <code>sync/data/product-curation.json</code>; new entries are checked with name rules. To change one,
          open it and pick “This is …” at the top of its page — that choice is never undone automatically
          ({o.hidden.manual} set so far).
        </p>
        {o.review.length > 0 && (
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {o.review.map((r) => (
              <li key={r.slug} className="truncate">
                <Link href={`/drugs/${encodeURIComponent(r.slug)}`} className="text-brand-600 hover:underline">{r.name}</Link>
                <span className="text-slate-400"> — {r.note}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
