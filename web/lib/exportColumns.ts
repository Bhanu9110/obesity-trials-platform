// Columns that can be exported from the Trials and Drugs pages (no database: shared by the export
// page in the browser and the export API). The API builds the rows (lib/exportData.ts).

export type Dataset = "trials" | "drugs";
export type ExportFormat = "xlsx" | "pdf" | "csv" | "docx";
export const FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "xlsx", label: "Excel", hint: ".xlsx — formatted sheet with filters, plus a sheet listing what was exported" },
  { key: "pdf", label: "PDF", hint: "landscape report: title, filters used, date, table" },
  { key: "csv", label: "CSV", hint: "plain comma-separated text for any tool" },
  { key: "docx", label: "Word", hint: ".docx — table in a Word document" },
];

export interface ColumnDef {
  key: string;
  label: string;
  /** shown first and ticked by default */
  core?: boolean;
  /** relative width in PDF / Word (1 = narrow, 3 = wide) */
  width?: number;
  /** a web link (Excel makes it clickable) */
  link?: boolean;
  /** a number (Excel keeps it numeric) */
  number?: boolean;
  group: string;
}

export const TRIAL_COLUMNS: ColumnDef[] = [
  { key: "nct_id", label: "NCT ID", core: true, width: 1.2, group: "Trial" },
  { key: "title", label: "Title", core: true, width: 3.5, group: "Trial" },
  { key: "drugs", label: "Drugs", core: true, width: 2, group: "Trial" },
  { key: "phase", label: "Phase", core: true, width: 1, group: "Trial" },
  { key: "status", label: "Status", core: true, width: 1.2, group: "Trial" },
  { key: "sponsor", label: "Sponsor", core: true, width: 2, group: "Sponsor" },
  { key: "sponsor_type", label: "Sponsor type", width: 1.2, group: "Sponsor" },
  { key: "conditions", label: "Conditions", width: 2.2, group: "Trial" },
  { key: "obesity_class", label: "Obesity relevance", width: 1.3, group: "Trial" },
  { key: "study_type", label: "Study type", width: 1.2, group: "Trial" },
  { key: "enrollment", label: "Enrollment", core: true, width: 0.9, number: true, group: "Trial" },
  { key: "start_date", label: "Start date", core: true, width: 1, group: "Dates" },
  { key: "primary_completion", label: "Primary completion", width: 1.1, group: "Dates" },
  { key: "completion", label: "Study completion", width: 1.1, group: "Dates" },
  { key: "last_update", label: "Last update", width: 1, group: "Dates" },
  { key: "continents", label: "Regions", width: 1.5, group: "Location" },
  { key: "countries", label: "Countries", width: 2.2, group: "Location" },
  { key: "ctgov_link", label: "ClinicalTrials.gov link", width: 2.2, link: true, group: "Links" },
];

export const DRUG_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Drug", core: true, width: 1.6, group: "Drug" },
  { key: "aliases", label: "Aliases / code names", core: true, width: 2.4, group: "Drug" },
  { key: "brand_names", label: "Brand names", width: 1.6, group: "Drug" },
  { key: "inn", label: "INN", width: 1.4, group: "Drug" },
  { key: "sponsor", label: "Company", core: true, width: 1.6, group: "Drug" },
  { key: "class_tag", label: "Targets (single / dual / triple)", width: 1.8, group: "Drug" },
  { key: "stage", label: "Development stage", core: true, width: 1.3, group: "Development" },
  { key: "top_phase", label: "Highest trial phase", width: 1.1, group: "Development" },
  { key: "regulatory_status", label: "Regulatory status", core: true, width: 3, group: "Development" },
  { key: "approved", label: "Approved", width: 0.8, group: "Development" },
  { key: "approval_date", label: "Approval date", width: 1, group: "Development" },
  { key: "next_milestone", label: "Next milestone", core: true, width: 2.4, group: "Development" },
  { key: "anticipated_launch", label: "Anticipated launch", width: 2, group: "Development" },
  { key: "designations", label: "Designations", width: 2, group: "Development" },
  { key: "patents", label: "Patents", width: 2.4, group: "Development" },
  { key: "drug_class", label: "Therapy class", core: true, width: 1.6, group: "Pharmacology" },
  { key: "therapy_subclass", label: "Sub-class", width: 1.8, group: "Pharmacology" },
  { key: "moa", label: "Mechanism of action", width: 2.6, group: "Pharmacology" },
  { key: "modality", label: "Modality", width: 1.2, group: "Pharmacology" },
  { key: "roa", label: "Route", width: 1.2, group: "Pharmacology" },
  { key: "api", label: "API (active ingredient)", width: 2, group: "Pharmacology" },
  { key: "efficacy_signal", label: "Efficacy signal", width: 3, group: "Results" },
  { key: "safety_signal", label: "Safety signal", width: 3, group: "Results" },
  { key: "trials", label: "Obesity trials", core: true, width: 0.9, number: true, group: "Trials" },
  { key: "all_trials", label: "All stored trials", width: 0.9, number: true, group: "Trials" },
  { key: "active_trials", label: "Trials running", width: 0.9, number: true, group: "Trials" },
  { key: "last_trial_year", label: "Newest trial start", width: 0.9, number: true, group: "Trials" },
  { key: "abstracts", label: "Conference abstracts", width: 0.9, number: true, group: "Trials" },
  { key: "page_link", label: "Drug page link", width: 2, link: true, group: "Links" },
];

export const columnsFor = (d: Dataset) => (d === "trials" ? TRIAL_COLUMNS : DRUG_COLUMNS);
export const defaultColumns = (d: Dataset) => columnsFor(d).filter((c) => c.core).map((c) => c.key);

/** The chosen column keys that exist, in catalogue order (unknown keys dropped). */
export function pickColumns(d: Dataset, keys: string[] | null | undefined): ColumnDef[] {
  const want = new Set((keys?.length ? keys : defaultColumns(d)));
  const out = columnsFor(d).filter((c) => want.has(c.key));
  return out.length ? out : columnsFor(d).filter((c) => c.core);
}

/** The filter parameters each list page keeps in its address (see the Trials and Drugs pages). */
export const FILTER_KEYS: Record<Dataset, string[]> = {
  trials: ["q", "phase", "status", "continent", "country", "sponsor", "sort"],
  drugs: ["q", "stage", "reg"],
};
