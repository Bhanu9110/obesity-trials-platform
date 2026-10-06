import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { CHANGE_KINDS, displayTimeZone, recentChanges, type ChangeItem } from "@/lib/queries";
import { NctLink } from "@/components/ui";
import { ChangeDetail, KIND_LABEL } from "@/components/ChangeDetail";
import { icons } from "@/components/shell/icons";

const KIND_TONE: Record<string, { text: string; dot: string; icon: React.ReactNode }> = {
  added: { text: "text-emerald-600", dot: "bg-emerald-50 text-emerald-600", icon: icons.plus },
  updated: { text: "text-sky-600", dot: "bg-sky-50 text-sky-600", icon: icons.pulse },
  reclassified: { text: "text-violet-600", dot: "bg-violet-50 text-violet-600", icon: icons.sparkles },
  removed: { text: "text-rose-600", dot: "bg-rose-50 text-rose-600", icon: icons.close },
};

function groupByDay(items: ChangeItem[]): [string, ChangeItem[]][] {
  const m = new Map<string, ChangeItem[]>();
  for (const c of items) {
    const d = c.changed_at.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), c]);
  }
  return [...m.entries()];
}

function dayLabel(day: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: displayTimeZone() });
  const y = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: displayTimeZone() });
  if (day === today) return "Today";
  if (day === y) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

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
      <PageHeader
        eyebrow="Registry radar"
        title="What"
        highlight="changed"
        description="New trials, registry updates field by field, reclassifications and removals — recorded automatically by every sync."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[{ k: null as string | null, label: "All changes", n: all, tone: "text-slate-950", ic: icons.history },
          ...CHANGE_KINDS.map((k) => ({ k, label: KIND_LABEL[k].label, n: data.counts[k] ?? 0, tone: KIND_TONE[k].text, ic: KIND_TONE[k].icon }))].map((x) => {
          const on = (x.k ?? undefined) === kind;
          return (
            <Link key={x.label} href={href({ kind: x.k })}
                  className={`glass group relative overflow-hidden rounded-2xl p-4 transition hover:-translate-y-0.5 ${on ? "!border-brand-500/50 shadow-glow" : ""}`}>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {x.label}<span className={`${x.tone} opacity-80`}>{x.ic}</span>
              </div>
              <div className={`mt-2 font-display text-[26px] font-semibold leading-none tabular-nums ${x.tone}`}>{x.n.toLocaleString()}</div>
              <div className="mt-1 text-xs text-slate-500">last {days === 365 ? "year" : `${days} days`}</div>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
          {DAY_CHOICES.map((d) => (
            <Link key={d} href={href({ days: d })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${d === days ? "bg-brand-500/15 text-brand-700" : "text-slate-500 hover:text-slate-900"}`}>
              {d === 365 ? "1 year" : `${d} days`}
            </Link>
          ))}
        </div>
        <form action="/changes" className="relative ml-auto">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {days !== 30 && <input type="hidden" name="days" value={days} />}
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
          <input name="q" defaultValue={q} placeholder="NCT ID or sponsor…"
                 className="w-64 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none" />
        </form>
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icons.history}</div>
          <div className="font-display text-base font-semibold text-slate-900">No changes in this period</div>
          <p className="mt-1 text-sm text-slate-500">Try a longer period. Changes are recorded by every daily sync.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupByDay(data.items).map(([day, list]) => (
            <section key={day}>
              <div className="sticky top-16 z-10 -mx-1 mb-3 flex items-center gap-3 bg-page-soft px-1 py-2 backdrop-blur">
                <span className="font-display text-sm font-semibold text-slate-950">{dayLabel(day)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600">{list.length}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
              </div>
              <ol className="relative ml-4 space-y-2 border-l border-slate-200 pl-6">
                {list.map((c) => {
                  const tone = KIND_TONE[c.change] ?? KIND_TONE.updated;
                  return (
                    <li key={c.id} className="relative">
                      <span className={`absolute -left-[37px] top-3 grid h-6 w-6 place-items-center rounded-full ring-4 ring-page ${tone.dot} [&>svg]:h-3.5 [&>svg]:w-3.5`}>
                        {tone.icon}
                      </span>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <NctLink id={c.trial_id} />
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_LABEL[c.change]?.style ?? ""}`}>
                            {KIND_LABEL[c.change]?.label ?? c.change}
                          </span>
                          {c.sponsor && <span className="truncate text-xs text-slate-500">{c.sponsor}</span>}
                          <span className="ml-auto text-xs tabular-nums text-slate-400">{c.changed_at.slice(11)}</span>
                        </div>
                        <div className="mt-1.5 text-sm"><ChangeDetail c={c} /></div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 hover:border-brand-500/50">← Newer</Link> : <span />}
          <span className="text-slate-500">Page <b className="text-slate-900">{page}</b> of {pages.toLocaleString()}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 hover:border-brand-500/50">Older →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
