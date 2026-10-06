import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authDisabled, isGuest, verifySession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getProduct, getProductTrials, productNames } from "@/lib/queries";
import { highestPhase } from "@/lib/format";
import ProductInfoCard from "@/components/ProductInfoCard";
import MergeProduct from "@/components/MergeProduct";
import DrugTrialsTable from "@/components/DrugTrialsTable";
import { Icon, StatTile } from "@/components/PageHeader";
import { BarList, SplitBar, YearColumns, type Segment } from "@/components/charts";
import { CHART_VIOLET, SERIES, phaseIndex } from "@/lib/chart-colors";
import { formatPhase } from "@/lib/format";

const STATUS_GROUPS = [
  { key: "recruiting", label: "Recruiting or opening", codes: ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"] },
  { key: "active", label: "Active, not recruiting", codes: ["ACTIVE_NOT_RECRUITING"] },
  { key: "completed", label: "Completed", codes: ["COMPLETED"] },
  { key: "stopped", label: "Stopped", codes: ["TERMINATED", "WITHDRAWN", "SUSPENDED"] },
  { key: "unknown", label: "Status unknown", codes: ["UNKNOWN", ""] },
];

function ChartCard({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 ${className}`}>
      <h2 className="font-display text-[15px] font-semibold text-slate-950">{title}</h2>
      {sub && <p className="mb-4 mt-0.5 text-xs text-slate-500">{sub}</p>}
      {children}
    </section>
  );
}

export const dynamic = "force-dynamic";

export default async function DrugPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ phase?: string }>;
}) {
  const { slug } = await params;
  const pickedPhase = ((await searchParams).phase ?? "").slice(0, 40) || undefined;
  const product = await getProduct(decodeURIComponent(slug));
  if (!product) notFound();
  const [trials, names] = await Promise.all([getProductTrials(product.id), productNames()]);
  const primary = trials.filter((t) => t.obesity_class === "primary");
  const viewOnly = !authDisabled() && isGuest(await verifySession((await cookies()).get(SESSION_COOKIE)?.value));

  return (
    <div className="space-y-5">
      <Link href="/drugs" className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-brand-600">
        ← All drugs
      </Link>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 md:p-7">
        <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="eyebrow mb-2 flex items-center gap-2">
              <span className="h-px w-6 bg-gradient-to-r from-transparent to-brand-500" /> Drug profile
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-slate-950">{product.name}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {primary.length.toLocaleString()} primary-obesity trial{primary.length === 1 ? "" : "s"}
              {trials.length > primary.length && <> · +{trials.length - primary.length} other stored</>}
            </p>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Trials" value={primary.length.toLocaleString()} sub="primary obesity" tone="cyan" icon={Icon.flask} />
          <StatTile label="Most advanced" value={primary.length ? highestPhase(primary.map((t) => t.phase)) : "—"} tone="pink" icon={Icon.rocket} />
          <StatTile label="Sponsors" value={new Set(primary.map((t) => t.sponsor).filter(Boolean)).size.toLocaleString()}
                    sub={`${primary.filter((t) => t.lead_sponsor_class === "INDUSTRY").length} industry trials`} tone="violet" icon={Icon.building} />
          <StatTile label="Recruiting" value={primary.filter((t) => ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"].includes(t.overall_status ?? "")).length.toLocaleString()}
                    sub="open or opening" tone="emerald" icon={Icon.pulse} />
        </div>
      </div>

      <ProductInfoCard product={product} readOnly={viewOnly} />

      {primary.length > 0 && (() => {
        const q = encodeURIComponent(product.name);
        const byPhase = new Map<string, number>();
        primary.forEach((t) => { const k = t.phase || "NONE"; byPhase.set(k, (byPhase.get(k) ?? 0) + 1); });
        const phaseRows = [...byPhase.entries()].sort((a, b) => phaseIndex(a[0]) - phaseIndex(b[0])).map(([k, v]) => ({
          key: k, label: k === "NONE" ? "Not specified" : formatPhase(k), title: k === "NONE" ? "No phase given" : formatPhase(k), value: v,
          href: `/drugs/${encodeURIComponent(product.slug)}?phase=${encodeURIComponent(k)}#trials`,
        }));
        const segments: Segment[] = STATUS_GROUPS.map((g, i) => ({
          key: g.key, label: g.label, color: SERIES[i],
          value: primary.filter((t) => g.codes.includes(t.overall_status ?? "")).length,
          href: `/trials?q=${q}&status=${encodeURIComponent(g.codes.filter(Boolean).join("|"))}`,
        }));
        const bySponsor = new Map<string, number>();
        primary.forEach((t) => { if (t.sponsor) bySponsor.set(t.sponsor, (bySponsor.get(t.sponsor) ?? 0) + 1); });
        const sponsorRows = [...bySponsor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([k, v]) => ({ key: k, label: k, title: k, value: v }));
        const years = new Map<number, number>();
        primary.forEach((t) => { const y = Number(t.start_date?.slice(0, 4)); if (y) years.set(y, (years.get(y) ?? 0) + 1); });
        const ys = [...years.keys()];
        const yearData = ys.length ? Array.from({ length: Math.max(...ys) - Math.min(...ys) + 1 }, (_, i) => {
          const y = Math.min(...ys) + i; return { year: y, count: years.get(y) ?? 0 };
        }).slice(-16) : [];
        return (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ChartCard title="Trials by phase" sub="Click a phase to list its trials below"><BarList rows={phaseRows} /></ChartCard>
              <ChartCard title="Recruitment status" sub="Where this drug's trials stand"><SplitBar segments={segments} /></ChartCard>
              <ChartCard title="Top sponsors" sub="Who runs the trials"><BarList rows={sponsorRows} color={CHART_VIOLET} /></ChartCard>
            </div>
            {yearData.length > 1 && (
              <ChartCard title="Trial starts per year" sub="By registered start date">
                <YearColumns data={yearData} currentYear={new Date().getFullYear()} wide />
              </ChartCard>
            )}
          </>
        );
      })()}

      <DrugTrialsTable key={pickedPhase ?? "none"} trials={trials} initialPhase={pickedPhase} />

      {!viewOnly && <MergeProduct slug={product.slug} name={product.name} options={names} />}
    </div>
  );
}
