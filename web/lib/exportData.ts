// Rows for an export (server only): the Trials explorer or the Drugs list, with the same filters
// the page had ("current filters") or everything, reduced to the chosen columns.

import { keyTrials, listProducts, listTrialsForExport, type KeyTrial, type TrialFilters } from "@/lib/queries";
import { drugPaperCounts, pubmedUrl, resultsPapers } from "@/lib/publications";
import { formatPhase, highestPhase, OBESITY_CLASSES, SPONSOR_GROUPS, TRIAL_STATUS, ctgovUrl } from "@/lib/format";
import { devStage, STAGE_META, type StageKey } from "@/lib/devStage";
import { regGroup, type RegGroup } from "@/lib/regulatory";
import { matchDrug } from "@/lib/drugSearch";
import { classForQuery, classMembers, targetsFor } from "@/lib/drugClasses";
import { cleanNames, splitNames } from "@/lib/aliases";
import { dateText } from "@/lib/milestones";
import { pickColumns, type ColumnDef, type Dataset } from "@/lib/exportColumns";
import type { ProductSummary } from "@/lib/types";

export type Cell = string | number | null;
export interface ExportTable {
  dataset: Dataset;
  title: string;
  /** "Search: GLP-1 · Phase 2" — or "Everything" */
  filters: string[];
  columns: ColumnDef[];
  rows: Cell[][];
  /** counts for the dashboard: by phase / status (trials) or by stage / status (drugs) */
  summary: { label: string; items: { label: string; value: number }[] }[];
  /** the export stopped at the row limit */
  truncated: boolean;
  total: number;
}

export const MAX_ROWS = 20000;
const join = (xs: (string | null | undefined)[] | null | undefined, sep = ", ") => (xs ?? []).filter(Boolean).join(sep) || null;

function counter() {
  const m = new Map<string, number>();
  return { add: (k: string | null | undefined) => m.set(k || "Not given", (m.get(k || "Not given") ?? 0) + 1),
    items: (order?: string[]) => [...m.entries()].map(([label, value]) => ({ label, value }))
      .sort((a, b) => (order ? (order.indexOf(a.label) + 1 || 99) - (order.indexOf(b.label) + 1 || 99) : 0) || b.value - a.value) };
}

// ---------------------------------------------------------------- Trials
export async function trialsTable(sp: URLSearchParams, scope: "filtered" | "all", columnKeys: string[], origin: string): Promise<ExportTable> {
  const split = (v: string | null) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : undefined);
  const filters: string[] = [];
  let f: TrialFilters = { scope: "all" };
  if (scope === "filtered") {
    const q = sp.get("q")?.trim() || undefined;
    const sponsor = sp.get("sponsor") ?? "";
    f = {
      q, phase: split(sp.get("phase")), status: split(sp.get("status")),
      country: sp.get("country") ? [sp.get("country")!] : undefined,
      continent: !sp.get("country") && sp.get("continent") ? [sp.get("continent")!] : undefined,
      sponsorClass: SPONSOR_GROUPS[sponsor]?.classes.split(","),
      sort: (sp.get("sort") as TrialFilters["sort"]) ?? undefined,
    };
    if (q) filters.push(`Search: ${q}`);
    if (f.phase?.length) filters.push(`Phase: ${f.phase.map(formatPhase).join(", ")}`);
    if (f.status?.length) filters.push(`Status: ${f.status.map((s) => TRIAL_STATUS[s]?.label ?? s).join(", ")}`);
    if (f.country?.length) filters.push(`Country: ${f.country[0]}`);
    else if (f.continent?.length) filters.push(`Region: ${f.continent[0]}`);
    if (SPONSOR_GROUPS[sponsor]) filters.push(`Sponsor: ${SPONSOR_GROUPS[sponsor].label}`);
    filters.push("Primary obesity trials");
  }
  const { rows: data, drugClass } = await listTrialsForExport(f, MAX_ROWS + 1);
  if (drugClass) filters.unshift(`Drug class: ${drugClass.label} (${drugClass.drugs} drugs)`);
  if (!filters.length) filters.push("Everything — every trial in the database, all obesity relevance classes");
  const truncated = data.length > MAX_ROWS;
  const rowsIn = data.slice(0, MAX_ROWS);
  const columns = pickColumns("trials", columnKeys);
  const papers = columns.some((c) => c.key === "results_paper")
    ? await resultsPapers(rowsIn.map((t) => t.nct_id)).catch(() => new Map<string, string[]>()) : new Map<string, string[]>();
  const value = (t: (typeof rowsIn)[number], key: string): Cell => {
    switch (key) {
      case "results_paper": return (papers.get(t.nct_id) ?? []).map(pubmedUrl).join("\n") || null;
      case "nct_id": return t.nct_id;
      case "title": return t.title;
      case "drugs": return t.drugs;
      case "phase": return t.phase && t.phase !== "NA" ? formatPhase(t.phase) : t.est_phase ? `${formatPhase(t.est_phase)} (est. from enrollment)` : t.phase ? formatPhase(t.phase) : null;
      case "status": return t.overall_status ? TRIAL_STATUS[t.overall_status]?.label ?? t.overall_status : null;
      case "sponsor": return t.sponsor;
      case "sponsor_type": return Object.values(SPONSOR_GROUPS).find((g) => g.classes.split(",").includes(t.lead_sponsor_class ?? ""))?.label.replace(/ only$/, "") ?? t.lead_sponsor_class;
      case "conditions": return join(t.conditions);
      case "obesity_class": return t.obesity_class ? OBESITY_CLASSES[t.obesity_class]?.label ?? t.obesity_class : null;
      case "study_type": return t.study_type ? t.study_type.charAt(0) + t.study_type.slice(1).toLowerCase().replace(/_/g, " ") : null;
      case "enrollment": return t.enrollment;
      case "start_date": return t.start_date;
      case "primary_completion": return t.primary_completion;
      case "completion": return t.completion;
      case "last_update": return t.last_update;
      case "continents": return join(t.continents);
      case "countries": return join(t.countries);
      case "ctgov_link": return ctgovUrl(t.nct_id);
      default: return null;
    }
  };
  const byPhase = counter(), byStatus = counter(), bySponsor = counter();
  for (const t of rowsIn) {
    byPhase.add(t.phase && t.phase !== "NA" ? formatPhase(t.phase) : t.est_phase ? `${formatPhase(t.est_phase)} (est.)` : null);
    byStatus.add(t.overall_status ? TRIAL_STATUS[t.overall_status]?.label ?? t.overall_status : null);
    bySponsor.add(value(t, "sponsor_type") as string | null);
  }
  void origin;
  return {
    dataset: "trials", title: "Obesity clinical trials", filters, columns,
    rows: rowsIn.map((t) => columns.map((c) => value(t, c.key))),
    summary: [
      { label: "By phase", items: byPhase.items(["Early Phase 1", "Phase 1", "Phase 1/2", "Phase 2", "Phase 2/3", "Phase 3", "Phase 4", "Not given"]) },
      { label: "By status", items: byStatus.items() },
      { label: "By sponsor type", items: bySponsor.items() },
    ],
    truncated, total: rowsIn.length,
  };
}

// ---------------------------------------------------------------- Drugs
const STAGE_KEYS = Object.keys(STAGE_META) as StageKey[];

/** The Drugs list as the page shows it: search (or drug class), stage chip, regulatory status. */
export function filterDrugs(products: ProductSummary[], sp: URLSearchParams, scope: "filtered" | "all") {
  const listed = products.filter((p) => p.trials > 0 || p.abstracts > 0);
  const filters: string[] = [];
  const targets = targetsFor(products);
  if (scope === "all") return { rows: listed, filters: ["Everything — every listed drug"], targets, members: null };
  const q = (sp.get("q") ?? "").trim();
  const stage = STAGE_KEYS.includes(sp.get("stage") as StageKey) ? (sp.get("stage") as StageKey) : null;
  const reg = sp.get("reg") ?? "";
  const cls = q ? classForQuery(q) : null;
  const members = cls ? classMembers(targets, cls) : null;
  let rows = listed;
  if (reg === "milestone") rows = rows.filter((p) => p.next_milestone);
  else if (reg) rows = rows.filter((p) => regGroup(p.regulatory_status, p.approved) === (reg as RegGroup));
  if (members) rows = rows.filter((p) => members.has(p));
  else if (q) rows = rows.filter((p) => matchDrug(p, q).hit);
  if (stage) rows = rows.filter((p) => devStage(p).key === stage);
  if (cls) filters.push(`Drug class: ${cls.label}`); else if (q) filters.push(`Search: ${q}`);
  if (stage) filters.push(`Stage: ${STAGE_META[stage].label}`);
  if (reg) filters.push(`Regulatory status: ${reg === "milestone" ? "with an upcoming milestone" : reg}`);
  if (!filters.length) filters.push("All listed drugs");
  // Phase-wise like the page: approved first, then filed, Phase 3, 2, 1 …
  rows = [...rows].sort((a, b) => STAGE_META[devStage(b).key].order - STAGE_META[devStage(a).key].order || b.trials - a.trials || a.name.localeCompare(b.name));
  return { rows, filters, targets, members };
}

export async function drugsTable(sp: URLSearchParams, scope: "filtered" | "all", columnKeys: string[], origin: string): Promise<ExportTable> {
  const products = await listProducts();
  const { rows: list, filters, targets, members } = filterDrugs(products, sp, scope);
  const columns = pickColumns("drugs", columnKeys);
  const keys = columns.some((c) => c.key === "key_trial") ? await keyTrials(list.map((p) => p.slug)) : new Map<string, KeyTrial>();
  const paperCounts = columns.some((c) => c.key === "pubmed_papers")
    ? await drugPaperCounts(list.map((p) => p.slug)).catch(() => new Map<string, number>()) : new Map<string, number>();
  const value = (p: ProductSummary, key: string): Cell => {
    switch (key) {
      case "pubmed_papers": return paperCounts.get(p.slug) ?? null;
      case "name": return p.name;
      case "aliases": return cleanNames(splitNames(p.aliases), p.name).join(", ") || null;
      case "brand_names": return p.brand_names;
      case "inn": return p.inn;
      case "sponsor": return p.sponsor;
      case "class_tag": {
        const t = targets.get(p);
        if (!t) return null;
        const l = members?.get(p) ?? null;
        if (l?.label) return l.label;
        const NAMES: [string, string][] = [["glp1", "GLP-1"], ["gip", "GIP"], ["glucagon", "glucagon"], ["amylin", "amylin"], ["glp2", "GLP-2"], ["npy2", "NPY2"]];
        const names = NAMES.filter(([k]) => t.agonist.has(k as never)).map(([, n]) => n);
        return names.length ? `${t.combination ? "Combination" : names.length === 1 ? "Single" : names.length === 2 ? "Dual" : "Triple"}: ${names.join(" + ")}` : null;
      }
      case "stage": return devStage(p).label;
      case "key_trial": return keyTrialText(devStage(p).key, keys.get(p.slug));
      case "top_phase": return p.trial_phases.length ? highestPhase(p.trial_phases) : p.phase;
      case "regulatory_status": return p.regulatory_status;
      case "approved": return p.approved;
      case "approval_date": return p.approval_date;
      case "next_milestone": return p.next_milestone ? `${dateText(p.next_milestone.date_label)} — ${p.next_milestone.title}` : null;
      case "page_link": return `${origin}/drugs/${encodeURIComponent(p.slug)}`;
      case "trials": case "all_trials": case "active_trials": case "last_trial_year": case "abstracts":
        return (p as unknown as Record<string, number | null>)[key] ?? null;
      default: return ((p as unknown as Record<string, string | null>)[key] ?? null) || null;
    }
  };
  const byStage = counter(), byReg = counter(), byClass = counter();
  for (const p of list) {
    byStage.add(devStage(p).label.replace(/ \(.*\)$/, ""));
    byReg.add(regGroup(p.regulatory_status, p.approved).replace(/^./, (c) => c.toUpperCase()));
    byClass.add(p.drug_class);
  }
  return {
    dataset: "drugs", title: "Obesity drugs", filters, columns,
    rows: list.map((p) => columns.map((c) => value(p, c.key))),
    summary: [
      { label: "By development stage", items: byStage.items(Object.values(STAGE_META).sort((a, b) => b.order - a.order).map((m) => m.label)) },
      { label: "By regulatory status", items: byReg.items() },
      { label: "By therapy class", items: byClass.items().slice(0, 8) },
    ],
    truncated: false, total: list.length,
  };
}

/**
 * "Key trial" for a drug:
 *   approved -> the trial(s) the approval was based on (research files), else its highest-phase trial, said so;
 *   others   -> one trial with its highest phase (obesity trials first; company-sponsored, running, largest first).
 */
export function keyTrialText(stage: string, k: KeyTrial | undefined): string | null {
  if (!k) return null;
  if (k.pivotal) return stage === "approved" ? `Approval based on: ${k.pivotal}` : k.pivotal;
  if (!k.nct_id) return stage === "approved" ? "Approved — approval trial not recorded"
    : "No ClinicalTrials.gov trial yet (known from conference abstracts or company reports)";
  const ph = k.phase && k.phase !== "NA" ? formatPhase(k.phase) : k.est_phase ? `${formatPhase(k.est_phase)} (est. from enrollment)` : "phase not given";
  const status = k.status ? TRIAL_STATUS[k.status]?.label ?? k.status : null;
  const detail = [ph, status, k.sponsor].filter(Boolean).join(", ");
  return stage === "approved"
    ? `${k.nct_id} (${detail}) — highest-phase trial; the approval trial isn't recorded`
    : `${k.nct_id} (${detail})`;
}

export async function buildTable(dataset: Dataset, sp: URLSearchParams, scope: "filtered" | "all", columns: string[], origin: string) {
  return dataset === "trials" ? trialsTable(sp, scope, columns, origin) : drugsTable(sp, scope, columns, origin);
}
