import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NCT_RE, fetchStudy, formatRegistryDate, humanize, type Study } from "@/lib/ctgov";
import { trialRecord, type StoredTrial } from "@/lib/queries";
import { OBESITY_CLASSES, ctgovUrl, formatPhase, SPONSOR_GROUPS } from "@/lib/format";
import { Chips, ContinentChips, Dash, ProductChips } from "@/components/ui";
import { ChangeDetail, KIND_LABEL } from "@/components/ChangeDetail";
import StudyDetails, { DETAIL_SECTIONS, SiteStatus } from "@/components/trial/StudyDetails";
import ResultsView, { RESULT_SECTIONS } from "@/components/trial/Results";
import { QUALITY_LABELS, SEV_STYLE } from "@/lib/quality-labels";

export const dynamic = "force-dynamic";

type Tab = "details" | "results" | "history";
type Params = { params: Promise<{ nct: string }>; searchParams: Promise<{ tab?: string }> };

const normalise = (raw: string) => decodeURIComponent(raw).trim().toUpperCase();

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const nct = normalise((await params).nct);
  if (!NCT_RE.test(nct)) return { title: "Trial not found" };
  const r = await fetchStudy(nct);
  const t = r.ok ? r.study.protocolSection?.identificationModule?.briefTitle : null;
  return { title: `${nct}${t ? ` · ${t}` : ""} | Obesity Trials Intelligence` };
}

function sponsorGroup(cls: string | null): string | null {
  if (!cls) return null;
  return Object.values(SPONSOR_GROUPS).find((g) => g.classes.split(",").includes(cls))?.label.replace(" only", "") ?? cls;
}

/** What this database holds about the trial: drugs, classification, quality. */
function DatabasePanel({ stored, removedAt, nct }: { stored: StoredTrial | null; removedAt: string | null; nct: string }) {
  if (!stored) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold">Not in the obesity drug database</div>
        <p className="mt-1">
          {removedAt
            ? <>This trial was in the database until {removedAt}, when it stopped meeting the database rules (a primary-obesity trial that names a drug). It is shown for reference only — see the History tab.</>
            : <>This trial does not meet the database rules (a primary-obesity trial that names a drug), so it is shown for reference only.</>}
        </p>
      </div>
    );
  }
  const cls = OBESITY_CLASSES[stored.obesity_class];
  const issues = stored.quality?.issues ?? [];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">In this database</h2>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Drugs</dt>
          <dd className="mt-1"><ProductChips products={stored.products} max={8} /></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Indication</dt>
          <dd className="mt-1"><Chips values={stored.conditions} max={4} /></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Classification</dt>
          <dd className="mt-1">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls?.badge ?? ""}`}>{cls?.label ?? stored.obesity_class}</span>
            {stored.obesity_reason && <p className="mt-1 text-xs text-slate-500">{stored.obesity_reason}</p>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Data quality</dt>
          <dd className="mt-1">
            {stored.quality ? (
              <>
                <span className={`font-semibold tabular-nums ${stored.quality.score >= 1 ? "text-emerald-600" : stored.quality.score >= 0.9 ? "text-sky-600" : stored.quality.score >= 0.75 ? "text-amber-600" : "text-rose-600"}`}>
                  {stored.quality.score.toFixed(2)}
                </span>
                {issues.length === 0 ? <span className="ml-1.5 text-xs text-emerald-600">no issues</span> : (
                  <ul className="mt-1 space-y-0.5">
                    {issues.map((i) => (
                      <li key={i.code} className="text-xs">
                        <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[i.severity] ?? ""}`}>{i.severity}</span>
                        <Link href={`/quality?code=${encodeURIComponent(i.code)}&q=${nct}`} className="text-slate-700 hover:underline">
                          {QUALITY_LABELS[i.code] ?? i.message}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <Dash />}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Sponsor</dt>
          <dd className="mt-1 text-slate-800">{stored.sponsor ?? <Dash />}{stored.lead_sponsor_class && <span className="ml-1.5 text-xs text-slate-400">({sponsorGroup(stored.lead_sponsor_class)})</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Phase</dt>
          <dd className="mt-1 text-slate-800">{stored.phase ? formatPhase(stored.phase) : <Dash />}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Location</dt>
          <dd className="mt-1"><ContinentChips continents={stored.continents} /></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Added to the database</dt>
          <dd className="mt-1 text-slate-800">{stored.first_seen_at ?? <Dash />}<span className="block text-xs text-slate-400">last checked {stored.last_seen_at ?? "—"}</span></dd>
        </div>
      </dl>
    </section>
  );
}

function SectionNav({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="Sections" className="sticky top-4 hidden w-52 shrink-0 self-start lg:block">
      <ul className="space-y-0.5 border-l border-slate-200 text-sm">
        {items.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-slate-600 hover:border-brand-600 hover:text-slate-900">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Lean stored facts, used when the registry cannot be reached. */
function StoredFallback({ stored, error }: { stored: StoredTrial; error: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold">Full study details are temporarily unavailable</div>
        <p className="mt-1">{error} The details below come from this database; reload the page in a few minutes for the complete record.</p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[13rem_1fr]">
          <dt className="text-slate-500">Title</dt><dd className="text-slate-800">{stored.title ?? <Dash />}</dd>
          <dt className="text-slate-500">Conditions</dt><dd><Chips values={stored.conditions} max={20} /></dd>
          <dt className="text-slate-500">Drug interventions</dt><dd className="text-slate-800">{stored.interventions.join(", ") || <Dash />}</dd>
          <dt className="text-slate-500">Phase</dt><dd className="text-slate-800">{stored.phase ? formatPhase(stored.phase) : <Dash />}</dd>
          <dt className="text-slate-500">Sponsor</dt><dd className="text-slate-800">{stored.sponsor ?? <Dash />}</dd>
          <dt className="text-slate-500">Countries</dt><dd className="text-slate-800">{stored.countries.join(", ") || <Dash />}</dd>
          <dt className="text-slate-500">Last updated on the registry</dt><dd className="text-slate-800">{formatRegistryDate(stored.source_updated_at) || <Dash />}</dd>
        </dl>
      </section>
    </div>
  );
}

export default async function TrialPage({ params, searchParams }: Params) {
  const nct = normalise((await params).nct);
  if (!NCT_RE.test(nct)) notFound();
  const sp = await searchParams;

  const [reg, record] = await Promise.all([fetchStudy(nct), trialRecord(nct)]);
  const { stored, changes } = record;
  if (!reg.ok && reg.notFound && !stored && !changes.length) notFound();

  const study: Study | null = reg.ok ? reg.study : null;
  const id = study?.protocolSection?.identificationModule;
  const st = study?.protocolSection?.statusModule;
  const ds = study?.protocolSection?.designModule;
  const hasResults = Boolean(study?.hasResults && study.resultsSection);
  const tab: Tab = sp.tab === "results" && hasResults ? "results" : sp.tab === "history" ? "history" : "details";
  const removed = !stored ? changes.find((c) => c.change === "removed") : undefined;
  const removedAt = removed?.changed_at ?? null;
  const title = id?.briefTitle ?? stored?.title ?? nct;
  const tabHref = (t: Tab) => `/trials/${nct}${t === "details" ? "" : `?tab=${t}`}`;
  const tabs: [Tab, string][] = [
    ["details", "Study details"],
    ...(hasResults ? [["results", "Results posted"] as [Tab, string]] : []),
    ["history", `History${changes.length ? ` (${changes.length})` : ""}`],
  ];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-brand-600 hover:underline">← All trials</Link>

      <header className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-slate-900 px-2 py-0.5 font-mono font-semibold text-white">{nct}</span>
          {st?.overallStatus && <SiteStatus s={st.overallStatus} />}
          {ds?.phases?.length ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">{ds.phases.map(humanize).join(" / ")}</span> : null}
          {ds?.studyType && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{humanize(ds.studyType)}</span>}
          {hasResults && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Results posted</span>}
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-snug text-slate-900">
          {title}{id?.acronym && <span className="ml-2 text-base font-normal text-slate-500">({id.acronym})</span>}
        </h1>
        {id?.officialTitle && id.officialTitle !== title && <p className="mt-1 text-sm text-slate-500">{id.officialTitle}</p>}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          {(study?.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? stored?.sponsor) && (
            <span><span className="text-slate-400">Sponsor</span> {study?.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? stored?.sponsor}</span>
          )}
          {ds?.enrollmentInfo?.count != null && <span><span className="text-slate-400">Enrollment</span> {ds.enrollmentInfo.count.toLocaleString()}</span>}
          {st?.startDateStruct?.date && <span><span className="text-slate-400">Start</span> {formatRegistryDate(st.startDateStruct.date)}</span>}
          {st?.primaryCompletionDateStruct?.date && <span><span className="text-slate-400">Primary completion</span> {formatRegistryDate(st.primaryCompletionDateStruct.date)}</span>}
          {st?.lastUpdatePostDateStruct?.date && <span><span className="text-slate-400">Last update</span> {formatRegistryDate(st.lastUpdatePostDateStruct.date)}</span>}
        </div>
      </header>

      <DatabasePanel stored={stored} removedAt={removedAt} nct={nct} />

      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {tabs.map(([t, label]) => (
          <Link
            key={t}
            href={tabHref(t)}
            scroll={false}
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "details" && (
        study ? (
          <div className="flex gap-6">
            <SectionNav items={DETAIL_SECTIONS} />
            <div className="min-w-0 flex-1"><StudyDetails study={study} /></div>
          </div>
        ) : stored ? (
          <StoredFallback stored={stored} error={reg.ok ? "" : reg.error} />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {reg.ok ? null : reg.error} Please try again in a few minutes.
          </div>
        )
      )}

      {tab === "results" && study?.resultsSection && (
        <div className="flex gap-6">
          <SectionNav items={RESULT_SECTIONS.filter(([sid]) => ({
            "participant-flow": study.resultsSection!.participantFlowModule,
            baseline: study.resultsSection!.baselineCharacteristicsModule,
            "outcome-measures": study.resultsSection!.outcomeMeasuresModule?.outcomeMeasures?.length,
            "adverse-events": study.resultsSection!.adverseEventsModule,
            "results-more": study.resultsSection!.moreInfoModule,
          } as Record<string, unknown>)[sid])} />
          <div className="min-w-0 flex-1"><ResultsView r={study.resultsSection} /></div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Changes tracked by this database</h3>
              <p className="text-xs text-slate-500">Every daily sync compares the registry record with the stored one and logs what changed.</p>
            </div>
            {changes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">No changes recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-5 py-2.5 font-semibold">When</th><th className="px-5 py-2.5 font-semibold">Change</th><th className="px-5 py-2.5 font-semibold">Details</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {changes.map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-600">{c.changed_at}</td>
                        <td className="px-5 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_LABEL[c.change]?.style ?? ""}`}>{KIND_LABEL[c.change]?.label ?? c.change}</span></td>
                        <td className="px-5 py-2.5"><ChangeDetail c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {st && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Registry record dates</h3>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[16rem_1fr]">
                {([
                  ["First submitted", st.studyFirstSubmitDate],
                  ["First posted", st.studyFirstPostDateStruct?.date],
                  ["Results first posted", st.resultsFirstPostDateStruct?.date],
                  ["Last update posted", st.lastUpdatePostDateStruct?.date],
                  ["Record verified", st.statusVerifiedDate],
                ] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{formatRegistryDate(v)}</dd></div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      <p className="border-t border-slate-200 pt-3 text-xs text-slate-400">
        Source: ClinicalTrials.gov record {nct}
        {st?.lastUpdatePostDateStruct?.date && <>, last updated on the registry {formatRegistryDate(st.lastUpdatePostDateStruct.date)}</>}
        {reg.ok && <>; retrieved {new Date(reg.retrievedAt).toLocaleString("en-GB", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</>}
        . Shown unchanged from the public registry.{" "}
        <a href={ctgovUrl(nct)} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300 hover:text-slate-600">
          Original record
        </a>
      </p>
    </div>
  );
}
