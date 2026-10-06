import type { AdverseEvent, Analysis, Denom, Group, Measure, Measurement, Study } from "@/lib/ctgov";
import { humanize } from "@/lib/ctgov";
import RichText from "@/components/RichText";

// "Results posted" tab: participant flow, baseline characteristics, outcome
// measures (with statistical analyses), adverse events and more information —
// the same blocks ClinicalTrials.gov shows for a trial with results.

type Results = NonNullable<Study["resultsSection"]>;

const th = "px-3 py-2 text-left text-xs font-semibold text-slate-600 align-bottom";
const td = "px-3 py-2 align-top text-sm text-slate-700";

function GroupHeader({ groups }: { groups: Group[] }) {
  return (
    <>
      {groups.map((g) => (
        <th key={g.id} className={`${th} min-w-[9rem]`}>
          <span title={g.description ?? ""} className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2">
            {g.title || g.id}
          </span>
        </th>
      ))}
    </>
  );
}

function GroupLegend({ groups }: { groups: Group[] }) {
  const described = groups.filter((g) => g.description);
  if (!described.length) return null;
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700">Group descriptions</summary>
      <dl className="mt-2 space-y-1.5">
        {described.map((g) => (
          <div key={g.id}>
            <dt className="font-medium text-slate-700">{g.title}</dt>
            <dd className="whitespace-pre-line">{g.description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** "12.3 (4.5)" / "−5.2 (−6.1 to −4.3)" / "45" — value with its spread or range. */
function cell(m?: Measurement, pct?: string): string {
  if (!m || (m.value == null && m.lowerLimit == null)) return "—";
  let s = m.value ?? "";
  if (m.spread) s += ` (${m.spread})`;
  else if (m.lowerLimit != null || m.upperLimit != null) s += ` (${m.lowerLimit ?? "NA"} to ${m.upperLimit ?? "NA"})`;
  if (pct) s += ` ${pct}`;
  return s.trim() || "—";
}

function pctOf(value?: string, denom?: string): string | undefined {
  const v = Number(value), d = Number(denom);
  if (!Number.isFinite(v) || !Number.isFinite(d) || d <= 0) return undefined;
  return `(${((v / d) * 100).toFixed(1)}%)`;
}

function denomRow(denoms: Denom[] | undefined, groups: Group[], label: string, prefix = "d") {
  return (denoms ?? []).map((d, i) => (
    <tr key={`${prefix}${i}`} className="bg-slate-50/70">
      <td className={`${td} font-medium`}>{label}{d.units && d.units !== "Participants" ? ` (${d.units})` : ""}</td>
      {groups.map((g) => (
        <td key={g.id} className={`${td} tabular-nums`}>{d.counts?.find((c) => c.groupId === g.id)?.value ?? "—"}</td>
      ))}
    </tr>
  ));
}

/** Measure table: groups as columns, class / category rows. */
function MeasureTable({ m, groups, denoms }: { m: Measure; groups: Group[]; denoms?: Denom[] }) {
  const isCount = m.paramType === "COUNT_OF_PARTICIPANTS" || m.paramType === "COUNT_OF_UNITS";
  const overall = (m.denoms?.length ? m.denoms : denoms)?.[0];
  const rows: React.ReactNode[] = [];
  (m.classes ?? []).forEach((cls, ci) => {
    const cats = cls.categories ?? [];
    const classDenom = cls.denoms?.[0] ?? overall;
    if (cls.title && (cats.length > 1 || cats[0]?.title)) {
      rows.push(
        <tr key={`c${ci}`}>
          <td colSpan={groups.length + 1} className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{cls.title}</td>
        </tr>,
      );
      if (cls.denoms?.length) rows.push(...denomRow(cls.denoms, groups, "Number analyzed", `cd${ci}-`));
    }
    cats.forEach((cat, ki) => {
      rows.push(
        <tr key={`c${ci}-${ki}`} className="border-t border-slate-100">
          <td className={`${td} ${cls.title && (cats.length > 1 || cat.title) ? "pl-6" : ""}`}>
            {cat.title || cls.title || (m.unitOfMeasure ?? "")}
          </td>
          {groups.map((g) => {
            const meas = cat.measurements?.find((x) => x.groupId === g.id);
            const d = classDenom?.counts?.find((c) => c.groupId === g.id)?.value;
            return (
              <td key={g.id} className={`${td} tabular-nums`}>
                {cell(meas, isCount && !meas?.spread && meas?.lowerLimit == null ? pctOf(meas?.value, d) : undefined)}
                {meas?.comment && <div className="text-[11px] text-slate-400">{meas.comment}</div>}
              </td>
            );
          })}
        </tr>,
      );
    });
  });
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left">
        <thead className="bg-slate-50">
          <tr>
            <th className={`${th} min-w-[14rem]`}>
              {[humanize(m.paramType), m.dispersionType ? `(${humanize(m.dispersionType)})` : ""].filter(Boolean).join(" ")}
              {m.unitOfMeasure && <div className="font-normal text-slate-400">Unit: {m.unitOfMeasure}</div>}
            </th>
            <GroupHeader groups={groups} />
          </tr>
        </thead>
        <tbody>
          {denomRow(m.denoms?.length ? m.denoms : denoms, groups, "Number analyzed")}
          {rows}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisBlock({ a, groups, n }: { a: Analysis; groups: Group[]; n: number }) {
  const names = (a.groupIds ?? []).map((id) => groups.find((g) => g.id === id)?.title ?? id);
  const rows: [string, React.ReactNode][] = [
    ["Comparison groups", names.join(" vs ")],
    ["Comments", a.groupDescription],
    ["Non-inferiority or equivalence", a.testedNonInferiority == null ? null : a.testedNonInferiority ? humanize(a.nonInferiorityType) || "Yes" : "No"],
    ["Non-inferiority comment", a.nonInferiorityComment],
    ["P-value", a.pValue && <span className="font-semibold">{a.pValue}</span>],
    ["P-value comment", a.pValueComment],
    ["Statistical method", a.statisticalMethod],
    ["Method comment", a.statisticalComment],
    ["Estimate", a.paramValue && `${humanize(a.paramType) || a.paramType}: ${a.paramValue}`],
    [`Confidence interval`, a.ciLowerLimit || a.ciUpperLimit
      ? `${a.ciPctValue ? `${a.ciPctValue}% ` : ""}${humanize(a.ciNumSides)} CI: ${a.ciLowerLimit ?? "NA"} to ${a.ciUpperLimit ?? "NA"}`
      : null],
    ["Dispersion", a.dispersionValue && `${humanize(a.dispersionType)}: ${a.dispersionValue}`],
    ["Estimation comment", a.estimateComment],
    ["Other analysis", a.otherAnalysisDescription],
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Statistical analysis {n}</div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        {rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-700">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OutcomeMeasure({ m, i }: { m: Measure; i: number }) {
  const groups = m.groups ?? [];
  return (
    <article id={`outcome-${i}`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{humanize(m.type)} outcome</div>
        <h4 className="mt-0.5 font-semibold text-slate-900">{m.title}</h4>
      </div>
      <RichText text={m.description} />
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        {m.timeFrame && (<><dt className="text-slate-500">Time frame</dt><dd className="text-slate-700">{m.timeFrame}</dd></>)}
        {m.populationDescription && (<><dt className="text-slate-500">Population</dt><dd className="text-slate-700">{m.populationDescription}</dd></>)}
      </dl>
      {m.reportingStatus === "NOT_POSTED" ? (
        <p className="text-sm text-slate-500">
          Results not posted yet{m.anticipatedPostingDate ? ` — anticipated ${m.anticipatedPostingDate}` : ""}.
        </p>
      ) : groups.length > 0 ? (
        <>
          <MeasureTable m={m} groups={groups} />
          <GroupLegend groups={groups} />
        </>
      ) : null}
      {(m.analyses ?? []).map((a, k) => <AnalysisBlock key={k} a={a} groups={groups} n={k + 1} />)}
    </article>
  );
}

function ParticipantFlow({ pf }: { pf: NonNullable<Results["participantFlowModule"]> }) {
  const groups = pf.groups ?? [];
  return (
    <div className="space-y-3">
      <RichText text={pf.recruitmentDetails} />
      {pf.preAssignmentDetails && (
        <div><div className="text-xs font-semibold uppercase text-slate-500">Pre-assignment details</div><RichText text={pf.preAssignmentDetails} /></div>
      )}
      {(pf.periods ?? []).map((p, pi) => (
        <div key={pi} className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-800">{p.title || `Period ${pi + 1}`}</div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50"><tr><th className={`${th} min-w-[12rem]`}>Milestone</th><GroupHeader groups={groups} /></tr></thead>
              <tbody>
                {(p.milestones ?? []).map((ms, mi) => (
                  <tr key={mi} className="border-t border-slate-100">
                    <td className={`${td} font-medium`}>{humanize(ms.type)}{ms.comment && <div className="text-[11px] font-normal text-slate-400">{ms.comment}</div>}</td>
                    {groups.map((g) => {
                      const a = ms.achievements?.find((x) => x.groupId === g.id);
                      return <td key={g.id} className={`${td} tabular-nums`}>{a?.numSubjects ?? "—"}{a?.comment && <div className="text-[11px] text-slate-400">{a.comment}</div>}</td>;
                    })}
                  </tr>
                ))}
                {(p.dropWithdraws ?? []).length > 0 && (
                  <tr><td colSpan={groups.length + 1} className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Reasons for not completing</td></tr>
                )}
                {(p.dropWithdraws ?? []).map((dw, di) => (
                  <tr key={`dw${di}`} className="border-t border-slate-100">
                    <td className={`${td} pl-6`}>{dw.type}</td>
                    {groups.map((g) => <td key={g.id} className={`${td} tabular-nums`}>{dw.reasons?.find((r) => r.groupId === g.id)?.numSubjects ?? "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <GroupLegend groups={groups} />
    </div>
  );
}

function Baseline({ b }: { b: NonNullable<Results["baselineCharacteristicsModule"]> }) {
  const groups = b.groups ?? [];
  return (
    <div className="space-y-4">
      <RichText text={b.populationDescription} />
      {(b.measures ?? []).map((m, i) => (
        <div key={i} className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-800">{m.title}</div>
          {m.description && <p className="text-xs text-slate-500">{m.description}</p>}
          <MeasureTable m={m} groups={groups} denoms={b.denoms} />
        </div>
      ))}
      <GroupLegend groups={groups} />
    </div>
  );
}

function EventsTable({ events, groups, label }: { events: AdverseEvent[]; groups: Group[]; label: string }) {
  const bySystem = new Map<string, AdverseEvent[]>();
  for (const e of events) {
    const k = e.organSystem || "Other";
    bySystem.set(k, [...(bySystem.get(k) ?? []), e]);
  }
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-slate-800">{label} ({events.length.toLocaleString()} event terms)</div>
      <div className="space-y-1">
        {[...bySystem.entries()].map(([sys, evs]) => (
          <details key={sys} className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              {sys} <span className="text-slate-400">· {evs.length}</span>
            </summary>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full">
                <thead className="bg-slate-50"><tr><th className={`${th} min-w-[14rem]`}>Event</th><GroupHeader groups={groups} /></tr></thead>
                <tbody>
                  {evs.map((e, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className={td}>
                        {e.term}
                        {e.assessmentType === "SYSTEMATIC_ASSESSMENT" && <span className="ml-1 text-[11px] text-slate-400">(systematic)</span>}
                        {e.notes && <div className="text-[11px] text-slate-400">{e.notes}</div>}
                      </td>
                      {groups.map((g) => {
                        const s = e.stats?.find((x) => x.groupId === g.id);
                        if (!s) return <td key={g.id} className={td}>—</td>;
                        const pct = s.numAtRisk ? ` (${((Number(s.numAffected ?? 0) / s.numAtRisk) * 100).toFixed(2)}%)` : "";
                        return (
                          <td key={g.id} className={`${td} tabular-nums`}>
                            {s.numAffected ?? "—"}/{s.numAtRisk ?? "—"}{pct}
                            {s.numEvents != null && <div className="text-[11px] text-slate-400">{s.numEvents} events</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function AdverseEvents({ ae }: { ae: NonNullable<Results["adverseEventsModule"]> }) {
  const groups = ae.eventGroups ?? [];
  const sum = (a?: number, r?: number) => (a == null ? "—" : `${a}/${r ?? "—"}${r ? ` (${((a / r) * 100).toFixed(2)}%)` : ""}`);
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        {ae.timeFrame && (<><dt className="text-slate-500">Time frame</dt><dd className="text-slate-700">{ae.timeFrame}</dd></>)}
        {ae.description && (<><dt className="text-slate-500">Description</dt><dd className="text-slate-700"><RichText text={ae.description} /></dd></>)}
        {ae.frequencyThreshold && (<><dt className="text-slate-500">Other events threshold</dt><dd className="text-slate-700">{ae.frequencyThreshold}%</dd></>)}
        {ae.allCauseMortalityComment && (<><dt className="text-slate-500">All-cause mortality</dt><dd className="text-slate-700">{ae.allCauseMortalityComment}</dd></>)}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className={`${th} min-w-[14rem]`}>Participants affected / at risk</th><GroupHeader groups={groups} /></tr></thead>
          <tbody>
            {([
              ["All-cause mortality", "deathsNumAffected", "deathsNumAtRisk"],
              ["Serious adverse events", "seriousNumAffected", "seriousNumAtRisk"],
              ["Other (non-serious) adverse events", "otherNumAffected", "otherNumAtRisk"],
            ] as const).map(([label, a, r]) => (
              <tr key={label} className="border-t border-slate-100">
                <td className={`${td} font-medium`}>{label}</td>
                {groups.map((g) => <td key={g.id} className={`${td} tabular-nums`}>{sum(g[a], g[r])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GroupLegend groups={groups} />
      {(ae.seriousEvents ?? []).length > 0 && <EventsTable events={ae.seriousEvents!} groups={groups} label="Serious adverse events" />}
      {(ae.otherEvents ?? []).length > 0 && <EventsTable events={ae.otherEvents!} groups={groups} label="Other adverse events" />}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

export const RESULT_SECTIONS = [
  ["participant-flow", "Participant flow"],
  ["baseline", "Baseline characteristics"],
  ["outcome-measures", "Outcome measures"],
  ["adverse-events", "Adverse events"],
  ["results-more", "Limitations and contacts"],
] as const;

export default function ResultsView({ r }: { r: Results }) {
  const om = r.outcomeMeasuresModule?.outcomeMeasures ?? [];
  const more = r.moreInfoModule;
  return (
    <div className="space-y-4">
      {r.participantFlowModule && <Section id="participant-flow" title="Participant flow"><ParticipantFlow pf={r.participantFlowModule} /></Section>}
      {r.baselineCharacteristicsModule && <Section id="baseline" title="Baseline characteristics"><Baseline b={r.baselineCharacteristicsModule} /></Section>}
      {om.length > 0 && (
        <section id="outcome-measures" className="scroll-mt-4 space-y-3">
          <h3 className="text-base font-semibold text-slate-900">Outcome measures ({om.length})</h3>
          <ol className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            {om.map((m, i) => (
              <li key={i}>
                <a href={`#outcome-${i}`} className="text-brand-600 hover:underline">
                  <span className="mr-1.5 text-xs uppercase text-slate-400">{humanize(m.type)}</span>{m.title}
                </a>
              </li>
            ))}
          </ol>
          {om.map((m, i) => <OutcomeMeasure key={i} m={m} i={i} />)}
        </section>
      )}
      {r.adverseEventsModule && <Section id="adverse-events" title="Adverse events"><AdverseEvents ae={r.adverseEventsModule} /></Section>}
      {more && (
        <Section id="results-more" title="Limitations and contacts">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
            {more.limitationsAndCaveats?.description && (<><dt className="text-slate-500">Limitations and caveats</dt><dd><RichText text={more.limitationsAndCaveats.description} /></dd></>)}
            {more.certainAgreement && (
              <>
                <dt className="text-slate-500">Investigator agreements</dt>
                <dd className="text-slate-700">
                  {more.certainAgreement.piSponsorEmployee ? "Principal investigators are employed by the sponsor." :
                    more.certainAgreement.restrictiveAgreement ? `Restrictive agreement${more.certainAgreement.restrictionType ? ` (${humanize(more.certainAgreement.restrictionType)})` : ""}.` :
                    "No restrictive agreement."}
                  {more.certainAgreement.otherDetails && <RichText text={more.certainAgreement.otherDetails} className="mt-1" />}
                </dd>
              </>
            )}
            {more.pointOfContact && (
              <>
                <dt className="text-slate-500">Results point of contact</dt>
                <dd className="text-slate-700">
                  {[more.pointOfContact.title, more.pointOfContact.organization].filter(Boolean).join(", ")}
                  {more.pointOfContact.email && <div>{more.pointOfContact.email}</div>}
                  {more.pointOfContact.phone && <div>{more.pointOfContact.phone}{more.pointOfContact.phoneExt ? ` ext. ${more.pointOfContact.phoneExt}` : ""}</div>}
                </dd>
              </>
            )}
          </dl>
        </Section>
      )}
    </div>
  );
}
