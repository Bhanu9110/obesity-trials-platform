import Link from "next/link";
import { listProducts, upcomingMilestones } from "@/lib/queries";
import PageHeader from "@/components/PageHeader";
import DrugsExplorer from "@/components/DrugsExplorer";
import { KIND_META, dateText, periodEnd } from "@/lib/milestones";

export const dynamic = "force-dynamic";

export default async function DrugsPage() {
  const [products, upcoming] = await Promise.all([listProducts(), upcomingMilestones(8)]);
  const today = Date.now() - 86400000;
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Drug intelligence"
        title="Obesity drugs"
        highlight="pipeline"
        description="Every drug found in obesity trial interventions, with how far each has progressed, where it stands with regulators and what comes next. Open one for its profile, results, milestones and every trial."
      />

      {upcoming.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
            <div>
              <h2 className="font-display text-[15px] font-semibold text-slate-950">Upcoming milestones</h2>
              <p className="text-xs text-slate-500">The next expected regulatory decisions, readouts and launches across all drugs. Quarters and years are company guidance or estimates.</p>
            </div>
          </div>
          <ol className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
            {upcoming.map((m, i) => {
              const k = KIND_META[m.kind];
              const end = periodEnd(m.date_label);
              const passed = end !== null && end.getTime() < today;
              return (
                <li key={`${m.slug}-${i}`} className="min-w-0 bg-white px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-semibold tabular-nums text-slate-900">{dateText(m.date_label)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${k.chip}`}>{k.label}</span>
                    {passed && <span className="text-[10px] font-medium text-amber-700" title="The expected date has passed — check whether it happened">date passed</span>}
                  </div>
                  <Link href={`/drugs/${encodeURIComponent(m.slug)}#milestones`} className="mt-1 block truncate text-sm font-medium text-brand-600 hover:underline">{m.name}</Link>
                  <p className="line-clamp-2 text-xs text-slate-600" title={m.title}>{m.title}{m.region ? ` (${m.region})` : ""}</p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <DrugsExplorer products={products} />
    </div>
  );
}
