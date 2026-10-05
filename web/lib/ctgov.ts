// Full study record from the ClinicalTrials.gov v2 API, for the in-site trial page.
//
// The database keeps only the lean fields the drug database needs; the complete
// record (descriptions, eligibility, outcomes, sites, results…) is read from the
// registry when a trial page is opened and cached on the server for a few hours,
// so stakeholders see every detail without leaving this website.
//
// Types below cover the parts of the v2 schema the page renders. Every field is
// optional: registry records are often incomplete.

export const NCT_RE = /^NCT\d{8}$/;

const API_BASE = (process.env.CTGOV_API_BASE || "https://clinicaltrials.gov/api/v2").replace(/\/+$/, "");
/** Seconds a fetched record is reused before it is fetched again. */
const REVALIDATE = Math.max(300, Number(process.env.CTGOV_CACHE_SECONDS) || 6 * 3600);

export type DateStruct = { date?: string; type?: string };
export type Group = { id?: string; title?: string; description?: string };
export type Measurement = {
  groupId?: string; value?: string; spread?: string; lowerLimit?: string; upperLimit?: string; comment?: string;
};
export type Denom = { units?: string; counts?: { groupId?: string; value?: string }[] };
export type MeasureClass = {
  title?: string;
  denoms?: Denom[];
  categories?: { title?: string; measurements?: Measurement[] }[];
};
export type Analysis = {
  groupIds?: string[]; groupDescription?: string; testedNonInferiority?: boolean; nonInferiorityType?: string;
  nonInferiorityComment?: string; pValue?: string; pValueComment?: string; statisticalMethod?: string;
  statisticalComment?: string; paramType?: string; paramValue?: string; ciPctValue?: string; ciNumSides?: string;
  ciLowerLimit?: string; ciUpperLimit?: string; dispersionType?: string; dispersionValue?: string;
  estimateComment?: string; otherAnalysisDescription?: string;
};
export type Measure = {
  type?: string; title?: string; description?: string; populationDescription?: string; reportingStatus?: string;
  anticipatedPostingDate?: string; paramType?: string; dispersionType?: string; unitOfMeasure?: string;
  unitOfDenom?: string; calculatePct?: boolean; timeFrame?: string; typeUnitsAnalyzed?: string;
  denomUnitsSelected?: string; groups?: Group[]; denoms?: Denom[]; classes?: MeasureClass[]; analyses?: Analysis[];
};
export type EventStat = { groupId?: string; numEvents?: number; numAffected?: number; numAtRisk?: number };
export type AdverseEvent = {
  term?: string; organSystem?: string; sourceVocabulary?: string; assessmentType?: string; notes?: string;
  stats?: EventStat[];
};
export type Contact = { name?: string; role?: string; phone?: string; phoneExt?: string; email?: string };
export type Location = {
  facility?: string; status?: string; city?: string; state?: string; zip?: string; country?: string;
  contacts?: Contact[];
};

export interface Study {
  hasResults?: boolean;
  protocolSection?: {
    identificationModule?: {
      nctId?: string; briefTitle?: string; officialTitle?: string; acronym?: string;
      orgStudyIdInfo?: { id?: string; type?: string; link?: string };
      secondaryIdInfos?: { id?: string; type?: string; domain?: string; link?: string }[];
      organization?: { fullName?: string; class?: string };
    };
    statusModule?: {
      statusVerifiedDate?: string; overallStatus?: string; lastKnownStatus?: string; whyStopped?: string;
      expandedAccessInfo?: { hasExpandedAccess?: boolean; nctId?: string };
      startDateStruct?: DateStruct; primaryCompletionDateStruct?: DateStruct; completionDateStruct?: DateStruct;
      studyFirstSubmitDate?: string; studyFirstSubmitQcDate?: string; studyFirstPostDateStruct?: DateStruct;
      resultsFirstSubmitDate?: string; resultsFirstSubmitQcDate?: string; resultsFirstPostDateStruct?: DateStruct;
      lastUpdateSubmitDate?: string; lastUpdatePostDateStruct?: DateStruct;
    };
    sponsorCollaboratorsModule?: {
      responsibleParty?: {
        type?: string; investigatorFullName?: string; investigatorTitle?: string; investigatorAffiliation?: string;
        oldNameTitle?: string; oldOrganization?: string;
      };
      leadSponsor?: { name?: string; class?: string };
      collaborators?: { name?: string; class?: string }[];
    };
    oversightModule?: {
      oversightHasDmc?: boolean; isFdaRegulatedDrug?: boolean; isFdaRegulatedDevice?: boolean;
      isUnapprovedDevice?: boolean; isPpsd?: boolean; isUsExport?: boolean;
    };
    descriptionModule?: { briefSummary?: string; detailedDescription?: string };
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    designModule?: {
      studyType?: string; patientRegistry?: boolean; targetDuration?: string; phases?: string[];
      designInfo?: {
        allocation?: string; interventionModel?: string; interventionModelDescription?: string;
        primaryPurpose?: string; observationalModel?: string; timePerspective?: string;
        maskingInfo?: { masking?: string; maskingDescription?: string; whoMasked?: string[] };
      };
      bioSpec?: { retention?: string; description?: string };
      enrollmentInfo?: { count?: number; type?: string };
    };
    armsInterventionsModule?: {
      armGroups?: { label?: string; type?: string; description?: string; interventionNames?: string[] }[];
      interventions?: {
        type?: string; name?: string; description?: string; armGroupLabels?: string[]; otherNames?: string[];
      }[];
    };
    outcomesModule?: {
      primaryOutcomes?: { measure?: string; description?: string; timeFrame?: string }[];
      secondaryOutcomes?: { measure?: string; description?: string; timeFrame?: string }[];
      otherOutcomes?: { measure?: string; description?: string; timeFrame?: string }[];
    };
    eligibilityModule?: {
      eligibilityCriteria?: string; healthyVolunteers?: boolean; sex?: string; genderBased?: boolean;
      genderBasedDescription?: string; minimumAge?: string; maximumAge?: string; stdAges?: string[];
      studyPopulation?: string; samplingMethod?: string;
    };
    contactsLocationsModule?: {
      centralContacts?: Contact[];
      overallOfficials?: { name?: string; affiliation?: string; role?: string }[];
      locations?: Location[];
    };
    referencesModule?: {
      references?: { pmid?: string; type?: string; citation?: string }[];
      seeAlsoLinks?: { label?: string; url?: string }[];
      availIpds?: { id?: string; type?: string; url?: string; comment?: string }[];
    };
    ipdSharingStatementModule?: {
      ipdSharing?: string; description?: string; infoTypes?: string[]; timeFrame?: string;
      accessCriteria?: string; url?: string;
    };
  };
  resultsSection?: {
    participantFlowModule?: {
      preAssignmentDetails?: string; recruitmentDetails?: string; typeUnitsAnalyzed?: string;
      groups?: Group[];
      periods?: {
        title?: string;
        milestones?: { type?: string; comment?: string; achievements?: { groupId?: string; comment?: string; numSubjects?: string; numUnits?: string }[] }[];
        dropWithdraws?: { type?: string; comment?: string; reasons?: { groupId?: string; comment?: string; numSubjects?: string }[] }[];
      }[];
    };
    baselineCharacteristicsModule?: {
      populationDescription?: string; typeUnitsAnalyzed?: string; groups?: Group[]; denoms?: Denom[];
      measures?: Measure[];
    };
    outcomeMeasuresModule?: { outcomeMeasures?: Measure[] };
    adverseEventsModule?: {
      frequencyThreshold?: string; timeFrame?: string; description?: string; allCauseMortalityComment?: string;
      eventGroups?: (Group & {
        deathsNumAffected?: number; deathsNumAtRisk?: number; seriousNumAffected?: number; seriousNumAtRisk?: number;
        otherNumAffected?: number; otherNumAtRisk?: number;
      })[];
      seriousEvents?: AdverseEvent[];
      otherEvents?: AdverseEvent[];
    };
    moreInfoModule?: {
      limitationsAndCaveats?: { description?: string };
      certainAgreement?: { piSponsorEmployee?: boolean; restrictionType?: string; restrictiveAgreement?: boolean; otherDetails?: string };
      pointOfContact?: { title?: string; organization?: string; email?: string; phone?: string; phoneExt?: string };
    };
  };
  documentSection?: {
    largeDocumentModule?: {
      noSap?: boolean;
      largeDocs?: {
        typeAbbrev?: string; hasProtocol?: boolean; hasSap?: boolean; hasIcf?: boolean; label?: string;
        date?: string; uploadDate?: string; filename?: string; size?: number;
      }[];
    };
  };
  derivedSection?: {
    conditionBrowseModule?: { meshes?: { id?: string; term?: string }[]; browseLeaves?: { id?: string; name?: string; relevance?: string }[] };
    interventionBrowseModule?: { meshes?: { id?: string; term?: string }[]; browseLeaves?: { id?: string; name?: string; relevance?: string }[] };
  };
}

export type StudyResult =
  | { ok: true; study: Study; retrievedAt: string }
  | { ok: false; notFound: boolean; error: string };

/** The full registry record for one NCT ID (cached server-side). */
export async function fetchStudy(nctId: string): Promise<StudyResult> {
  if (!NCT_RE.test(nctId)) return { ok: false, notFound: true, error: "Not a valid NCT ID." };
  const url = `${API_BASE}/studies/${nctId}?format=json`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "obesity-trials-platform/1.0 (trial detail page)" },
      next: { revalidate: REVALIDATE, tags: [`ctgov:${nctId}`] },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return { ok: false, notFound: true, error: "ClinicalTrials.gov has no record with this ID." };
    if (!res.ok) return { ok: false, notFound: false, error: `ClinicalTrials.gov answered ${res.status}.` };
    const study = (await res.json()) as Study;
    if (study?.protocolSection?.identificationModule?.nctId !== nctId) {
      return { ok: false, notFound: false, error: "ClinicalTrials.gov returned an unexpected record." };
    }
    return { ok: true, study, retrievedAt: res.headers.get("date") ?? new Date().toUTCString() };
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "ClinicalTrials.gov did not answer in time." : "ClinicalTrials.gov could not be reached.";
    console.error(`[ctgov] ${nctId}:`, e);
    return { ok: false, notFound: false, error: msg };
  }
}

/** Link to a protocol / SAP / consent document posted with the record. */
export function largeDocUrl(nctId: string, filename: string): string {
  return `https://cdn.clinicaltrials.gov/large-docs/${nctId.slice(-2)}/${nctId}/${encodeURIComponent(filename)}`;
}

/** "ACTIVE_NOT_RECRUITING" -> "Active, not recruiting"; "PHASE2" -> "Phase 2". */
export function humanize(v?: string | null): string {
  if (!v) return "";
  const special: Record<string, string> = {
    NA: "Not applicable", EARLY_PHASE1: "Early Phase 1", ACTIVE_NOT_RECRUITING: "Active, not recruiting",
    ENROLLING_BY_INVITATION: "Enrolling by invitation", NOT_YET_RECRUITING: "Not yet recruiting",
    PRINCIPAL_INVESTIGATOR: "Principal Investigator", SPONSOR_INVESTIGATOR: "Sponsor-Investigator",
    STUDY_CHAIR: "Study Chair", STUDY_DIRECTOR: "Study Director", OUTCOMES_ASSESSOR: "Outcomes Assessor",
    CARE_PROVIDER: "Care Provider", NON_RANDOMIZED: "Non-randomized", NIH: "NIH", FED: "Federal (US)",
    OTHER_GOV: "Other government", INDIV: "Individual", ACTUAL: "Actual", ESTIMATED: "Estimated",
    SAP: "Statistical analysis plan", CSR: "Clinical study report", ICF: "Informed consent form",
    STUDY_PROTOCOL: "Study protocol", ANALYTIC_CODE: "Analytic code", EUDRACT_NUMBER: "EudraCT number",
    CTIS: "EU CT number", NON_PROBABILITY_SAMPLE: "Non-probability sample", NIH_GRANT: "NIH grant",
    FDA_REGULATED: "FDA-regulated",
  };
  if (special[v]) return special[v];
  const m = v.match(/^PHASE(\d)$/);
  if (m) return `Phase ${m[1]}`;
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2021-03" / "2021-03-15" -> "March 2021" / "15 March 2021". */
export function formatRegistryDate(d?: string | null): string {
  if (!d) return "";
  const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return d;
  const month = new Date(Date.UTC(2000, Number(m[2]) - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}
