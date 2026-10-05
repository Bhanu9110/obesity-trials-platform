import Link from "next/link";
import { CHANGE_KINDS, displayTimeZone, recentChanges, type ChangeItem } from "@/lib/queries";
import { NctLink } from "@/components/ui";
import { ChangeDetail, KIND_LABEL } from "@/components/ChangeDetail";

export const dynamic = "force-dynamic";

const DAY_CHOICES = [7, 30, 90, 365];

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; days?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind && (CHANGE_KINDS as readonly string[]).includes(sp.kind) ? sp.kind : undefined;
  const days = DAY_CHOICES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await recentChanges({ kind, days, q, page, pageSize: 50 });
  const pages = Math.max(1, Math.ceil(data.total / 50));
  const all = Object.values(data.counts).reduce((a, b) => a + b, 0);

  const href = (o: { kind?: string | null; days?: number; page?: number }) => {
    const p = new URLSearchParams();
    const k = o.kind === undefined ? kind : o.kind;
    if (k) p.set("kind", k);
    const d = o.days ?? days;
    if (d !== 30) p.set("days", String(d));
    if (q) p.set("q", q);
    if ((o.page ?? 1) > 1) p.set("page", String(o.page));
    const s = p.toString();
    return `/changes${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Recent changes</h1>
        <p className="text-sm text-slate-500">
          What changed in the database: new trials, registry updates (field by field), reclassifications and
          removals. Recorded automatically by every sync.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={href({ kind: null })}
              className={`rounded-full px-3 py-1 ${!kind ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
          All ({all.toLocaleString()})
        </Link>
        {CHANGE_KINDS.map((k) => (
          <Link key={k} href={href({ kind: k })}
                className={`rounded-full px-3 py-1 ${kind === k ? "bg-brand-600 text-white" : `${KIND_LABEL[k].style} hover:opacity-80`}`}>
            {KIND_LABEL[k].label} ({(data.counts[k] ?? 0).toLocaleString()})
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {DAY_CHOICES.map((d) => (
          <Link key={d} href={href({ days: d })}
                className={`rounded-md px-2 py-1 ${d === days ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>
            {d === 365 ? "1 year" : `${d} days`}
          </Link>
        ))}
        <form action="/changes" className="ml-auto flex gap-2">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {days !== 30 && <input type="hidden" name="days" value={days} />}
          <input name="q" defaultValue={q} placeholder="NCT ID or sponsor…"
                 className="w-48 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500" />
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold" title={displayTimeZone()}>
                When <span className="font-normal normal-case text-slate-400">({displayTimeZone() === "Asia/Kolkata" ? "IST" : displayTimeZone()})</span>
              </th>
              <th className="px-4 py-3 font-semibold">Trial</th>
              <th className="px-4 py-3 font-semibold">Change</th>
              <th className="px-4 py-3 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No changes in this period. Changes are recorded from the first sync after this feature was installed.
                </td>
              </tr>
            ) : (
              data.items.map((c) => (
                <tr key={c.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{c.changed_at}</td>
                  <td className="px-4 py-2.5">
                    <NctLink id={c.trial_id} />
                    {c.sponsor && <div className="text-xs text-slate-400">{c.sponsor}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_LABEL[c.change]?.style ?? ""}`}>
                      {KIND_LABEL[c.change]?.label ?? c.change}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><ChangeDetail c={c} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5">Prev</Link> : <span />}
          <span className="text-slate-500">Page {page} of {pages.toLocaleString()}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5">Next</Link> : <span />}
        </div>
      )}
    </div>
  );
}
