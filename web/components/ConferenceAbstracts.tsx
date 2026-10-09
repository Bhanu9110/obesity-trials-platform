import type { ConferenceAbstractRow } from "@/lib/queries";

// Conference abstracts (e.g. ADA 2026) that name this drug: stage, sponsor, model, finding, link.
export default function ConferenceAbstracts({ abstracts }: { abstracts: ConferenceAbstractRow[] }) {
  if (!abstracts.length) return null;
  const sources = [...new Set(abstracts.map((a) => a.source))].join(", ");
  return (
    <section id="abstracts" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="font-display text-[15px] font-semibold text-slate-950">Conference abstracts</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {abstracts.length} abstract{abstracts.length === 1 ? "" : "s"} from {sources} naming this drug — clinical and preclinical work presented at the meeting.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-semibold">Abstract</th>
              <th className="py-2 pr-3 font-semibold">Stage</th>
              <th className="py-2 pr-3 font-semibold">Program / sponsor</th>
              <th className="py-2 pr-3 font-semibold">Model / population</th>
              <th className="py-2 font-semibold">Finding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {abstracts.map((a) => (
              <tr key={`${a.source}|${a.abstract_no}`}>
                <td className="max-w-[320px] py-2.5 pr-3">
                  {a.link ? (
                    <a href={a.link} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                      {a.title ?? a.abstract_no}
                    </a>
                  ) : <span className="font-medium text-slate-800">{a.title ?? a.abstract_no}</span>}
                  <div className="mt-0.5 text-xs text-slate-400">{a.source} · {a.abstract_no}</div>
                </td>
                <td className="py-2.5 pr-3 text-slate-700">
                  <div className="whitespace-nowrap">{a.stage ?? "—"}</div>
                  {a.trial_ids?.length > 0 && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {a.trial_ids.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          {/^NCT\d{8}$/.test(id)
                            ? <a href={`https://clinicaltrials.gov/study/${id}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{id}</a>
                            : id}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.study_type && /post hoc/i.test(a.study_type) && <div className="text-xs text-slate-400">{a.study_type}</div>}
                </td>
                <td className="py-2.5 pr-3 text-slate-700">
                  <div>{a.program ?? "—"}</div>
                  {a.sponsor && <div className="text-xs text-slate-500">{a.sponsor}</div>}
                </td>
                <td className="py-2.5 pr-3 text-slate-600">{a.model ?? "—"}</td>
                <td className="py-2.5 text-slate-600">{a.key_finding ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
