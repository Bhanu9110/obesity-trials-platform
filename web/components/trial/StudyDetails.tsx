import type { DateStruct, Location, Study } from "@/lib/ctgov";
import { formatRegistryDate, humanize, largeDocUrl } from "@/lib/ctgov";
import RichText from "@/components/RichText";
import { Dash } from "@/components/ui";

// "Study details" tab: every protocol section of the registry record, in the
// order ClinicalTrials.gov shows them.

type Protocol = NonNullable<Study["protocolSection"]>;

export const DETAIL_SECTIONS = [
  ["overview", "Study overview"],
  ["eligibility", "Participation criteria"],
  ["plan", "Study plan"],
  ["outcomes", "Outcome measures"],
  ["locations", "Contacts and locations"],
  ["investigators", "Collaborators and investigators"],
  ["publications", "Publications"],
  ["dates", "Study record dates"],
  ["more", "More information"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

/** Two-column facts list; empty values are skipped. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[13rem_1fr]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const yesNo = (v?: boolean) => (v == null ? null : v ? "Yes" : "No");
const date = (d?: DateStruct) =>
  d?.date ? <>{formatRegistryDate(d.date)}{d.type && <span className="ml-1.5 text-xs text-slate-400">({humanize(d.type)})</span>}</> : null;
const list = (v?: string[]) => (v?.length ? v.map(humanize).join(", ") : null);

function Tags({ values }: { values?: string[] }) {
  if (!values?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => <span key={v} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{v}</span>)}
    </div>
  );
}

function OutcomeTable({ rows }: { rows: { measure?: string; description?: string; timeFrame?: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Outcome measure</th>
            <th className="px-3 py-2 font-semibold">Measure description</th>
            <th className="w-48 px-3 py-2 font-semibold">Time frame</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((o, i) => (
            <tr key={i} className="align-top">
              <td className="px-3 py-2 font-medium text-slate-800">{o.measure}</td>
              <td className="px-3 py-2 text-slate-700">{o.description ? <RichText text={o.description} /> : <Dash />}</td>
              <td className="px-3 py-2 text-slate-700">{o.timeFrame || <Dash />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  RECRUITING: "bg-emerald-50 text-emerald-700",
  NOT_YET_RECRUITING: "bg-sky-50 text-sky-700",
  ENROLLING_BY_INVITATION: "bg-sky-50 text-sky-700",
  ACTIVE_NOT_RECRUITING: "bg-amber-50 text-amber-700",
  COMPLETED: "bg-slate-100 text-slate-700",
};
export function SiteStatus({ s }: { s?: string }) {
  if (!s) return null;
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s] ?? "bg-rose-50 text-rose-700"}`}>{humanize(s)}</span>;
}

function Locations({ locations }: { locations: Location[] }) {
  const byCountry = new Map<string, Location[]>();
  for (const l of locations) {
    const k = l.country || "Country not given";
    byCountry.set(k, [...(byCountry.get(k) ?? []), l]);
  }
  const countries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-slate-500">
        {locations.length.toLocaleString()} site{locations.length === 1 ? "" : "s"} in {countries.length} countr{countries.length === 1 ? "y" : "ies"}
      </p>
      {countries.map(([country, sites]) => (
        <details key={country} open={countries.length <= 2} className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            {country} <span className="font-normal text-slate-400">· {sites.length}</span>
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {sites
              .slice()
              .sort((a, b) => `${a.state ?? ""}${a.city ?? ""}`.localeCompare(`${b.state ?? ""}${b.city ?? ""}`))
              .map((l, i) => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <div className="text-slate-800">{l.facility || "Site name not given"}</div>
                    <div className="text-xs text-slate-500">{[l.city, l.state, l.zip].filter(Boolean).join(", ")}</div>
                    {(l.contacts ?? []).map((c, k) => (
                      <div key={k} className="text-xs text-slate-500">
                        {[c.name, humanize(c.role)].filter(Boolean).join(" · ")}
                        {c.phone && <> · {c.phone}{c.phoneExt ? ` ext. ${c.phoneExt}` : ""}</>}
                        {c.email && <> · {c.email}</>}
                      </div>
                    ))}
                  </div>
                  <SiteStatus s={l.status} />
                </li>
              ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export default function StudyDetails({ study }: { study: Study }) {
  const p: Protocol = study.protocolSection ?? {};
  const id = p.identificationModule ?? {};
  const st = p.statusModule ?? {};
  const sp = p.sponsorCollaboratorsModule ?? {};
  const ds = p.designModule ?? {};
  const di = ds.designInfo ?? {};
  const el = p.eligibilityModule ?? {};
  const arms = p.armsInterventionsModule ?? {};
  const oc = p.outcomesModule ?? {};
  const cl = p.contactsLocationsModule ?? {};
  const refs = p.referencesModule ?? {};
  const ipd = p.ipdSharingStatementModule;
  const ov = p.oversightModule;
  const docs = study.documentSection?.largeDocumentModule?.largeDocs ?? [];
  const nct = id.nctId ?? "";
  const meshCond = study.derivedSection?.conditionBrowseModule?.meshes ?? [];
  const meshInt = study.derivedSection?.interventionBrowseModule?.meshes ?? [];
  const observational = ds.studyType === "OBSERVATIONAL";

  return (
    <div className="space-y-4">
      <Section id="overview" title="Study overview">
        {p.descriptionModule?.briefSummary && <Sub title="Brief summary"><RichText text={p.descriptionModule.briefSummary} /></Sub>}
        {p.descriptionModule?.detailedDescription && (
          <Sub title="Detailed description">
            {p.descriptionModule.detailedDescription.length > 1500 ? (
              <details>
                <summary className="cursor-pointer select-none text-sm text-brand-600 hover:underline">Show detailed description</summary>
                <RichText text={p.descriptionModule.detailedDescription} className="mt-2" />
              </details>
            ) : (
              <RichText text={p.descriptionModule.detailedDescription} />
            )}
          </Sub>
        )}
        <Facts rows={[
          ["Official title", id.officialTitle],
          ["Acronym", id.acronym],
          ["Conditions", p.conditionsModule?.conditions?.length ? <Tags key="c" values={p.conditionsModule.conditions} /> : null],
          ["Keywords", p.conditionsModule?.keywords?.length ? <Tags key="k" values={p.conditionsModule.keywords} /> : null],
          ["Intervention / treatment", arms.interventions?.length ? (
            <ul key="i" className="space-y-0.5">
              {arms.interventions.map((iv, i) => <li key={i}><span className="text-slate-500">{humanize(iv.type)}:</span> {iv.name}</li>)}
            </ul>
          ) : null],
          ["Study type", humanize(ds.studyType) + (ds.patientRegistry ? " (patient registry)" : "")],
          ["Phase", list(ds.phases)],
          ["Overall status", st.overallStatus && <SiteStatus key="s" s={st.overallStatus} />],
          ["Why stopped", st.whyStopped],
          ["Enrollment", ds.enrollmentInfo?.count != null ? (
            <>{ds.enrollmentInfo.count.toLocaleString()} participants{ds.enrollmentInfo.type && <span className="ml-1.5 text-xs text-slate-400">({humanize(ds.enrollmentInfo.type)})</span>}</>
          ) : null],
          ["Study start", date(st.startDateStruct)],
          ["Primary completion", date(st.primaryCompletionDateStruct)],
          ["Study completion", date(st.completionDateStruct)],
          ["Target follow-up", ds.targetDuration],
          ["Other study IDs", [id.orgStudyIdInfo?.id, ...(id.secondaryIdInfos ?? []).map((s) => [s.id, s.type ? humanize(s.type) : null, s.domain].filter(Boolean).join(" · "))].filter(Boolean).join("; ") || null],
        ]} />
      </Section>

      <Section id="eligibility" title="Participation criteria">
        <Facts rows={[
          ["Ages eligible", el.minimumAge && el.maximumAge ? `${el.minimumAge} to ${el.maximumAge}`
            : el.minimumAge ? `${el.minimumAge} and older` : el.maximumAge ? `Up to ${el.maximumAge}` : null],
          ["Age groups", list(el.stdAges)],
          ["Sexes eligible", humanize(el.sex)],
          ["Gender-based", el.genderBased ? el.genderBasedDescription || "Yes" : null],
          ["Accepts healthy volunteers", yesNo(el.healthyVolunteers)],
          ["Sampling method", humanize(el.samplingMethod)],
        ]} />
        {el.studyPopulation && <Sub title="Study population"><RichText text={el.studyPopulation} /></Sub>}
        {el.eligibilityCriteria && <Sub title="Eligibility criteria"><RichText text={el.eligibilityCriteria} /></Sub>}
      </Section>

      <Section id="plan" title="Study plan">
        <Sub title="Design details">
          <Facts rows={observational ? [
            ["Observational model", humanize(di.observationalModel)],
            ["Time perspective", humanize(di.timePerspective)],
            ["Biospecimen", ds.bioSpec ? [humanize(ds.bioSpec.retention), ds.bioSpec.description].filter(Boolean).join(" — ") : null],
          ] : [
            ["Primary purpose", humanize(di.primaryPurpose)],
            ["Allocation", humanize(di.allocation)],
            ["Intervention model", humanize(di.interventionModel)],
            ["Model description", di.interventionModelDescription],
            ["Masking", di.maskingInfo?.masking ? `${humanize(di.maskingInfo.masking)}${di.maskingInfo.whoMasked?.length ? ` (${di.maskingInfo.whoMasked.map(humanize).join(", ")})` : ""}` : null],
            ["Masking description", di.maskingInfo?.maskingDescription],
          ]} />
        </Sub>
        {(arms.armGroups?.length ?? 0) > 0 && (
          <Sub title={observational ? "Groups and cohorts" : "Arms and interventions"}>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="w-1/2 px-3 py-2 font-semibold">Participant group / arm</th>
                    <th className="px-3 py-2 font-semibold">Intervention / treatment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {arms.armGroups!.map((a, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{a.label}</div>
                        {a.type && <div className="text-xs text-slate-500">{humanize(a.type)}</div>}
                        {a.description && <RichText text={a.description} className="mt-1" />}
                      </td>
                      <td className="px-3 py-2">
                        {(a.interventionNames ?? []).length ? (
                          <ul className="space-y-1">
                            {a.interventionNames!.map((n) => {
                              const iv = arms.interventions?.find((x) => `${humanize(x.type)}: ${x.name}`.toLowerCase() === n.toLowerCase() || n.toLowerCase().endsWith(`: ${(x.name ?? "").toLowerCase()}`));
                              return (
                                <li key={n}>
                                  <span className="text-slate-800">{n}</span>
                                  {iv?.description && <RichText text={iv.description} className="text-xs text-slate-500" />}
                                  {iv?.otherNames?.length ? <div className="text-xs text-slate-500">Other names: {iv.otherNames.join(", ")}</div> : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : <Dash />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sub>
        )}
        {!arms.armGroups?.length && (arms.interventions?.length ?? 0) > 0 && (
          <Sub title="Interventions">
            <ul className="space-y-2 text-sm">
              {arms.interventions!.map((iv, i) => (
                <li key={i}>
                  <span className="text-slate-500">{humanize(iv.type)}:</span> <span className="font-medium text-slate-800">{iv.name}</span>
                  {iv.description && <RichText text={iv.description} className="text-xs" />}
                  {iv.otherNames?.length ? <div className="text-xs text-slate-500">Other names: {iv.otherNames.join(", ")}</div> : null}
                </li>
              ))}
            </ul>
          </Sub>
        )}
      </Section>

      <Section id="outcomes" title="Outcome measures">
        {oc.primaryOutcomes?.length ? <Sub title="Primary outcome measures"><OutcomeTable rows={oc.primaryOutcomes} /></Sub> : null}
        {oc.secondaryOutcomes?.length ? <Sub title="Secondary outcome measures"><OutcomeTable rows={oc.secondaryOutcomes} /></Sub> : null}
        {oc.otherOutcomes?.length ? <Sub title="Other outcome measures"><OutcomeTable rows={oc.otherOutcomes} /></Sub> : null}
        {!oc.primaryOutcomes?.length && !oc.secondaryOutcomes?.length && !oc.otherOutcomes?.length && (
          <p className="text-sm text-slate-500">No outcome measures listed on the registry.</p>
        )}
      </Section>

      <Section id="locations" title="Contacts and locations">
        {cl.centralContacts?.length ? (
          <Sub title="Study contacts">
            <ul className="space-y-1 text-sm text-slate-700">
              {cl.centralContacts.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-slate-800">{c.name}</span>
                  {c.role && <span className="text-slate-500"> · {humanize(c.role)}</span>}
                  {c.phone && <> · {c.phone}{c.phoneExt ? ` ext. ${c.phoneExt}` : ""}</>}
                  {c.email && <> · {c.email}</>}
                </li>
              ))}
            </ul>
          </Sub>
        ) : null}
        {cl.locations?.length ? <Locations locations={cl.locations} /> : <p className="text-sm text-slate-500">No sites listed on the registry.</p>}
      </Section>

      <Section id="investigators" title="Collaborators and investigators">
        <Facts rows={[
          ["Sponsor", sp.leadSponsor?.name && <>{sp.leadSponsor.name}{sp.leadSponsor.class && <span className="ml-1.5 text-xs text-slate-400">({humanize(sp.leadSponsor.class)})</span>}</>],
          ["Collaborators", sp.collaborators?.length ? (
            <ul key="c" className="space-y-0.5">{sp.collaborators.map((c, i) => <li key={i}>{c.name}{c.class && <span className="ml-1.5 text-xs text-slate-400">({humanize(c.class)})</span>}</li>)}</ul>
          ) : null],
          ["Investigators", cl.overallOfficials?.length ? (
            <ul key="o" className="space-y-0.5">
              {cl.overallOfficials.map((o, i) => <li key={i}>{o.name}{o.role && <span className="text-slate-500"> · {humanize(o.role)}</span>}{o.affiliation && <span className="text-slate-500"> · {o.affiliation}</span>}</li>)}
            </ul>
          ) : null],
          ["Responsible party", sp.responsibleParty?.type ? (
            <>
              {humanize(sp.responsibleParty.type)}
              {sp.responsibleParty.investigatorFullName && <> · {sp.responsibleParty.investigatorFullName}</>}
              {sp.responsibleParty.investigatorTitle && <> · {sp.responsibleParty.investigatorTitle}</>}
              {sp.responsibleParty.investigatorAffiliation && <> · {sp.responsibleParty.investigatorAffiliation}</>}
            </>
          ) : null],
          ["Registry organisation", id.organization?.fullName],
        ]} />
      </Section>

      <Section id="publications" title="Publications">
        {refs.references?.length ? (
          <ul className="space-y-2 text-sm text-slate-700">
            {refs.references.map((r, i) => (
              <li key={i}>
                {r.citation}
                <span className="ml-1.5 text-xs text-slate-400">{r.type ? humanize(r.type) : ""}</span>
                {r.pmid && /^\d+$/.test(r.pmid) && (
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-xs text-brand-600 hover:underline">
                    PubMed {r.pmid}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No publications listed on the registry.</p>}
        {refs.seeAlsoLinks?.length ? (
          <Sub title="Helpful links">
            <ul className="space-y-1 text-sm">
              {refs.seeAlsoLinks.filter((l) => l.url && /^https?:\/\//.test(l.url)).map((l, i) => (
                <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{l.label || l.url}</a></li>
              ))}
            </ul>
          </Sub>
        ) : null}
      </Section>

      <Section id="dates" title="Study record dates">
        <Facts rows={[
          ["First submitted", formatRegistryDate(st.studyFirstSubmitDate)],
          ["First submitted that met QC criteria", formatRegistryDate(st.studyFirstSubmitQcDate)],
          ["First posted", date(st.studyFirstPostDateStruct)],
          ["Results first submitted", formatRegistryDate(st.resultsFirstSubmitDate)],
          ["Results first posted", date(st.resultsFirstPostDateStruct)],
          ["Last update submitted", formatRegistryDate(st.lastUpdateSubmitDate)],
          ["Last update posted", date(st.lastUpdatePostDateStruct)],
          ["Record verified", formatRegistryDate(st.statusVerifiedDate)],
        ]} />
      </Section>

      <Section id="more" title="More information">
        <Facts rows={[
          ["Data monitoring committee", yesNo(ov?.oversightHasDmc)],
          ["FDA-regulated drug", yesNo(ov?.isFdaRegulatedDrug)],
          ["FDA-regulated device", yesNo(ov?.isFdaRegulatedDevice)],
          ["Product exported from the US", yesNo(ov?.isUsExport)],
          ["Expanded access available", st.expandedAccessInfo?.hasExpandedAccess == null ? null : yesNo(st.expandedAccessInfo.hasExpandedAccess)],
          ["Results posted", yesNo(study.hasResults)],
        ]} />
        {ipd && (
          <Sub title="Individual participant data (IPD) sharing">
            <Facts rows={[
              ["Plan to share IPD", humanize(ipd.ipdSharing)],
              ["Description", ipd.description && <RichText key="d" text={ipd.description} />],
              ["Supporting information", list(ipd.infoTypes)],
              ["Time frame", ipd.timeFrame],
              ["Access criteria", ipd.accessCriteria && <RichText key="a" text={ipd.accessCriteria} />],
              ["URL", ipd.url && /^https?:\/\//.test(ipd.url) ? <a key="u" href={ipd.url} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 hover:underline">{ipd.url}</a> : null],
            ]} />
          </Sub>
        )}
        {docs.length > 0 && nct && (
          <Sub title="Study documents">
            <ul className="space-y-1 text-sm">
              {docs.filter((d) => d.filename).map((d, i) => (
                <li key={i}>
                  <a href={largeDocUrl(nct, d.filename!)} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                    {d.label || [d.hasProtocol && "Study protocol", d.hasSap && "Statistical analysis plan", d.hasIcf && "Informed consent form"].filter(Boolean).join(" and ") || d.filename}
                  </a>
                  <span className="ml-1.5 text-xs text-slate-400">
                    {[formatRegistryDate(d.date), d.size ? `${Math.round(d.size / 1024).toLocaleString()} KB` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Sub>
        )}
        {(meshCond.length > 0 || meshInt.length > 0) && (
          <Sub title="MeSH terms (from the registry)">
            <Facts rows={[
              ["Conditions", meshCond.length ? <Tags key="mc" values={meshCond.map((m) => m.term ?? "").filter(Boolean)} /> : null],
              ["Interventions", meshInt.length ? <Tags key="mi" values={meshInt.map((m) => m.term ?? "").filter(Boolean)} /> : null],
            ]} />
          </Sub>
        )}
      </Section>
    </div>
  );
}
