import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authDisabled, readSession } from "@/lib/auth";
import { homeStats, overview } from "@/lib/queries";
import { formatPhase, phaseRank } from "@/lib/format";
import PageHeader, { StatTile } from "@/components/PageHeader";
import { BarList, SplitBar, YearColumns, type Segment } from "@/components/charts";
import { SERIES, phaseIndex } from "@/lib/chart-colors";
import { PhaseText } from "@/components/ui";
import { icons } from "@/components/shell/icons";

export const dynamic = "force-dynamic";

const STATUS_GROUPS = [
  { key: "recruiting", label: "Recruiting or opening", codes: ["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"] },
  { key: "active", label: "Active, not recruiting", codes: ["ACTIVE_NOT_RECRUITING"] },
  { key: "completed", label: "Completed", codes: ["COMPLETED"] },
  { key: "stopped", label: "Stopped (terminated, withdrawn, suspended)", codes: ["TERMINATED", "WITHDRAWN", "SUSPENDED"] },
  { key: "unknown", label: "Status unknown", codes: ["UNKNOWN"] },
];

function Card({ title, sub, action, children, className = "" }: {
  title: string; sub?: string; action?: { href: string; label: string }; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-slate-950">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {action && (
          <Link href={action.href} className="group flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            {action.label}<span className="transition-transform group-hover:translate-x-0.5">{icons.arrowRight}</span>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function OverviewPage() {
  const session = authDisabled() ? null : await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  const can = (p: string) => !session?.pages || session.pages.includes(p);

  let data: Awaited<ReturnType<typeof overview>>;
  let stats: Awaited<ReturnType<typeof homeStats>>;
  try {
    [data, stats] = await Promise.all([overview(), homeStats()]);
  } catch (err) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <h1 className="mb-1 font-display text-lg font-semibold">The overview didn&apos;t load</h1>
        <p>{err instanceof Error ? err.message : "Database error"} — reload the page in a moment.</p>
      </div>
    );
  }

  const year = new Date().getFullYear();
  const phaseRows = [...data.phases]
    .sort((a, b) => phaseIndex(a.name) - phaseIndex(b.name) || phaseRank(a.name) - phaseRank(b.name))
    .map((p) => ({
      key: p.name,
      label: p.name === "NONE" ? "Not specified" : formatPhase(p.name),
      title: p.name === "NONE" ? "No phase given" : formatPhase(p.name),
      value: p.count,
      href: p.name === "NONE" ? undefined : `/trials?phase=${encodeURIComponent(p.name)}`,
    }));
  const statusCount = Object.fromEntries(data.statuses.map((s) => [s.name, s.count]));
  const segments: Segment[] = STATUS_GROUPS.map((g, i) => ({
    key: g.key, label: g.label, color: SERIES[i],
    value: g.codes.reduce((a, c) => a + (statusCount[c] ?? 0), 0),
    href: `/trials?status=${encodeURIComponent(g.codes.join("|"))}`,
  }));
  const synced = stats.lastSync
    ? new Date(stats.lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const pct = (v: number) => (stats.trials ? `${Math.round((v / stats.trials) * 100)}% of trials` : "");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Obesity pipeline intelligence"
        title="The obesity drug landscape,"
        highlight="at a glance."
        description="Every interventional obesity trial on ClinicalTrials.gov — cleaned, classified and linked to its drugs and sponsors. Click any bar to explore those trials."
        actions={
          <>
            {synced && (
              <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-600">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]" />
                Synced {synced}
              </span>
            )}
            <Link href="/trials" className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm text-white">
              Explore trials {icons.arrowRight}
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Trials tracked" value={stats.trials.toLocaleString()} sub="primary obesity" tone="cyan" icon={icons.trials} />
        <StatTile label="Drugs" value={stats.drugs.toLocaleString()} sub="in those trials" tone="violet" icon={icons.drugs} />
        <StatTile label="Industry" value={stats.industry.toLocaleString()} sub={pct(stats.industry)} tone="sky" icon={icons.building} />
        <StatTile label="Late stage" value={stats.late.toLocaleString()} sub="Phase 3 / Phase 4" tone="pink" icon={icons.rocket} />
        <StatTile label="Recruiting" value={stats.recruiting.toLocaleString()} sub="open or opening" tone="emerald" icon={icons.pulse} />
        <StatTile label="Countries" value={stats.countries.toLocaleString()} sub="with trial sites" tone="amber" icon={icons.globe} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Pipeline by phase" sub="Primary-obesity trials per development phase" action={{ href: "/trials?sort=phase", label: "Explore" }} className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <BarList rows={phaseRows.slice(0, Math.ceil(phaseRows.length / 2))} max={Math.max(...phaseRows.map((r) => r.value))} />
            <BarList rows={phaseRows.slice(Math.ceil(phaseRows.length / 2))} max={Math.max(...phaseRows.map((r) => r.value))} />
          </div>
        </Card>
        <Card title="Recruitment status" sub="Where the trials stand today">
          <SplitBar segments={segments} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Trial starts per year" sub={`Primary-obesity trials by start date · ${year} so far shown lighter`} className="xl:col-span-2">
          <YearColumns data={data.startYears} currentYear={year} />
        </Card>
        <Card title="Where trials run" sub="Trials with at least one site in each region">
          <BarList rows={data.regions.map((r) => ({ key: r.name, label: r.name, title: r.name, value: r.count, href: `/trials?continent=${encodeURIComponent(r.name)}` }))} color="#a78bfa" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Most active sponsors" sub="By number of trials" action={{ href: "/trials", label: "All trials" }}>
          <BarList rows={data.sponsors.map((s) => ({
            key: s.name, title: s.name, value: s.count, href: `/trials?q=${encodeURIComponent(s.name)}`,
            label: <span className="flex items-center gap-2"><span className="truncate">{s.name}</span>{s.industry && <span className="shrink-0 rounded bg-sky-50 px-1 text-[10px] font-semibold uppercase text-sky-700 ring-1 ring-sky-200">industry</span>}</span>,
          }))} />
        </Card>

        <Card title="Leading drugs" sub="Most trials in obesity" action={can("drugs") ? { href: "/drugs", label: "All drugs" } : undefined}>
          <ol className="space-y-1">
            {data.drugs.map((d, i) => {
              const top = [...d.phases].sort((a, b) => phaseRank(b) - phaseRank(a))[0] ?? null;
              const inner = (
                <>
                  <span className="w-5 font-display text-xs font-semibold text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600 ring-1 ring-accent-200/70">{icons.drugs}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900 group-hover:text-brand-700">{d.name}</span>
                    <span className="text-xs text-slate-500">{d.trials} trials</span>
                  </span>
                  <PhaseText phase={top} />
                </>
              );
              const cls = "group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-100/40";
              return <li key={d.slug}>{can("drugs") ? <Link href={`/drugs/${encodeURIComponent(d.slug)}`} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>;
            })}
          </ol>
        </Card>

        <Card title="Latest trials added" sub={`${data.changes7d.toLocaleString()} registry changes in the last 7 days`}
              action={can("changes") ? { href: "/changes", label: "All changes" } : undefined} className="lg:col-span-2 xl:col-span-1">
          <ul className="space-y-1">
            {data.latest.map((t) => (
              <li key={t.nct_id}>
                <Link href={`/trials/${t.nct_id}`} className="group block rounded-xl px-2 py-2 transition hover:bg-slate-100/40">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono font-medium text-brand-600">{t.nct_id}</span>
                    <span className="text-slate-400">· added {t.first_seen}</span>
                    <span className="ml-auto"><PhaseText phase={t.phase} /></span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-slate-800 group-hover:text-slate-950">{t.title ?? "Title appears after the next sync"}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{[t.sponsor, t.products.map((p) => p.name).join(", ")].filter(Boolean).join(" · ")}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
