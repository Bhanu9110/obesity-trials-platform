// Automatic drug profiles ("auto-fill").
//
// Fills the blank drug-profile fields of every product with values worked out from
//   - our own trial data (company, indication, highest phase, pipeline status,
//     combination parts, code names and route words in the intervention names)
//   - ChEMBL (EMBL-EBI, free, CC BY-SA): modality, mechanism of action,
//     research codes, trade names, max phase, withdrawn flag
//   - openFDA drugsfda (US FDA, public domain): US brand names, route,
//     first US approval date, FDA pharmacologic class
//   - NCATS Inxight Drugs (NIH, public API): development status, highest phase,
//     approval year, targets + action (mechanism), substance type, code names, brands
//
// Results go to products.auto_info as {field: {value, source}}. The hand-entered
// columns are never written: the website shows an automatic value only while the
// matching hand-entered field is blank. External lookups are cached in
// products.auto_lookup and refreshed every ENRICH_REFRESH_DAYS days, a limited
// number per run, so the daily job stays short and polite to both services.

import { readFileSync } from "node:fs";
import { pool } from "./db.js";
import { config } from "./config.js";
import { loadAliases } from "./sync.js";
import { importAbstracts, type ImportResult } from "./abstracts.js";
import { applyCuration, type CurationResult } from "./curation.js";
import {
  BUILTIN_ALIASES, buildKnownSet, isUndisclosedProduct, productsFromName, slugify, type AliasMap,
} from "./products.js";

// Bump when the lookup format changes: cached lookups of an older version are redone.
export const LOOKUP_VERSION = 1;

export const enrichConfig = {
  external: (process.env.ENRICH_EXTERNAL ?? "true").toLowerCase() !== "false",
  maxLookups: Number(process.env.ENRICH_MAX_LOOKUPS ?? 200),
  budgetMs: Number(process.env.ENRICH_BUDGET_MIN ?? 15) * 60_000,
  refreshDays: Number(process.env.ENRICH_REFRESH_DAYS ?? 30),
  chemblBase: (process.env.CHEMBL_API_BASE ?? "https://www.ebi.ac.uk/chembl/api/data").replace(/\/$/, ""),
  fdaBase: (process.env.OPENFDA_API_BASE ?? "https://api.fda.gov").replace(/\/$/, ""),
  fdaKey: process.env.OPENFDA_API_KEY ?? "",
  inxightBase: (process.env.INXIGHT_API_BASE ?? "https://drugs.ncats.io/api/v1").replace(/\/$/, ""),
  maxInxight: Number(process.env.ENRICH_MAX_INXIGHT ?? 100),
  inxightDelayMs: Number(process.env.INXIGHT_REQUEST_DELAY_MS ?? 2500), // it answers 503 to quick bursts
  inxightRetryMs: Number(process.env.INXIGHT_RETRY_MS ?? 20_000),
  // Sources to leave out, e.g. "inxight" while that service blocks us: openfda, chembl, inxight.
  skipSources: new Set((process.env.ENRICH_SKIP_SOURCES ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean)),
  delayMs: Number(process.env.ENRICH_REQUEST_DELAY_MS ?? 150),
  timeoutMs: Number(process.env.ENRICH_TIMEOUT_MS ?? 25_000),
};

export type InfoField =
  | "aliases" | "brand_names" | "candidate" | "parent_drug" | "sponsor" | "drug_class" | "therapy_subclass"
  | "indication" | "modality" | "phase" | "moa" | "roa" | "approved" | "approval_date";

export interface AutoValue { value: string; source: string }
export type AutoInfo = Partial<Record<InfoField, AutoValue>>;

// --------------------------------------------------------------------------- #
// Lookup results (what is cached in products.auto_lookup)
// --------------------------------------------------------------------------- #
export interface ChemblInfo {
  id: string;
  name: string | null;
  type: string | null;           // "Small molecule" | "Protein" | "Antibody" | ...
  maxPhase: number | null;       // 4 = approved somewhere
  firstApproval: number | null;  // year
  oral: boolean;
  parenteral: boolean;
  topical: boolean;
  withdrawn: boolean;
  tradeNames: string[];
  codes: string[];
  mechanisms: { moa: string; action: string | null }[];
}

export interface FdaInfo {
  brands: string[];              // NDA/BLA brands first, marketed before discontinued
  routes: string[];              // e.g. ["SUBCUTANEOUS"]
  firstApproval: string | null;  // YYYY-MM-DD of the earliest original approval
  sponsors: string[];            // NDA/BLA sponsors as FDA writes them
  generics: number;              // number of ANDA (generic) applications
  marketed: boolean;             // at least one product not discontinued
  epc: string[];                 // FDA established pharmacologic class
  moa: string[];                 // FDA mechanism of action class
}

export interface InxightInfo {
  unii: string;                  // FDA UNII, e.g. "OYN3CCI6QE" (drugs.ncats.io/drug/<unii>)
  name: string;
  status: string | null;         // Development Status: "US Approved Rx" | "Clinical" | "Discontinued" | ...
  highestPhase: string | null;   // "Approved" | "Phase III" | ...
  approvalYear: number | null;
  conditions: string[];
  targets: { target: string; action: string | null }[]; // e.g. GLP-1 receptor / "partial agonist"
  substanceClass: string | null; // "chemical" | "protein" | "nucleicAcid" | "mixture" | ...
  codes: string[];               // code names (VX-548, LY3298176)
  brands: string[];
}

export interface Lookup {
  v: number;
  chembl: (ChemblInfo | null)[]; // one per component (a combination has several)
  fda: FdaInfo | null;
  at: string;
  fdaAt?: string;    // when openFDA was last asked (falls back to `at`)
  chemblAt?: string; // when ChEMBL was last asked (falls back to `at`)
  inxight?: (InxightInfo | null)[]; // one per component
  inxightAt?: string;
}

// --------------------------------------------------------------------------- #
// Small helpers
// --------------------------------------------------------------------------- #
const uniqBy = <T>(xs: T[], key: (x: T) => string) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const uniqText = (xs: string[]) => uniqBy(xs.map((x) => x.trim()).filter(Boolean), (x) => slugify(x));

/** "SEMAGLUTIDE" -> "Semaglutide", "WEGOVY" -> "Wegovy"; keeps mixed case as written. */
export function titleCase(s: string): string {
  const t = s.trim();
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const CODE_TOKEN_RE = /\b(?!NCT\d)[A-Z]{1,6}-?\d{3,}[A-Z0-9-]*\b/g;
const isCode = (s: string) => /\d/.test(s) && /^[A-Za-z]{1,6}[- ]?\d[A-Za-z0-9-]*$/.test(s.trim());

function phaseLevel(p: string | null | undefined): number {
  const s = (p ?? "").toUpperCase();
  if (s.includes("PHASE4")) return 4;
  if (s.includes("PHASE3")) return 3;
  if (s.includes("PHASE2")) return 2;
  if (s.includes("PHASE1")) return 1; // EARLY_PHASE1 too
  return 0;
}

// --------------------------------------------------------------------------- #
// Mechanism -> therapy subclass / class (shared by ChEMBL, FDA and product names)
// --------------------------------------------------------------------------- #
export function subclassFrom(text: string, smallMolecule = false): string | null {
  const t = text.toLowerCase();
  const glp1 = /glucagon-like peptide[- ]1|glp-?1|oxyntomodulin/.test(t);
  const gip = /gastric inhibitory polypeptide|glucose-dependent insulinotropic|\bgipr?\b/.test(t);
  const gipAntagonist = /(gastric inhibitory polypeptide|\bgipr?\b)[^;]*(antagonist|inhibitor|blocker)/.test(t);
  const oxm = /oxyntomodulin/.test(t); // GLP-1 + glucagon receptor co-agonist
  const gcg = oxm || /(^|[^-])\bglucagon receptor\b|\bgcgr?\b|glucagon agonist|\bglucagon\b(?!-like)(?=\s*[/,]|\s+(dual|triple|co-?agonist))|[/,]\s*glucagon\b(?!-like)/.test(t);
  const amylin = /amylin|amlintide|pramlintide|calcitonin receptor/.test(t);
  const hits = [gip && !gipAntagonist && "GIP", glp1 && "GLP-1", gcg && "glucagon", amylin && "amylin"].filter((x): x is string => !!x);
  const multi = hits.length >= 4 || /tetra|quadruple|quintuple|penta/.test(t);
  if (glp1 && hits.length >= 3) return multi ? `${hits.join("/")} multi-agonist` : `${hits.join("/")} triple agonist`;
  if (glp1 && gipAntagonist) return "GLP-1 agonist / GIPR antagonist";
  if (glp1 && gip) return "GIP/GLP-1 dual agonist";
  if (glp1 && gcg) return "GLP-1/glucagon dual agonist";
  if (glp1 && amylin) return "Amylin/GLP-1 dual agonist";
  if (amylin) return "Amylin analogue";
  if (glp1) return smallMolecule ? "Oral small-molecule GLP-1 RA" : "GLP-1 receptor agonist";
  if (/melanocortin[- ]?(receptor )?4|mc4r?\b/.test(t)) return "MC4R agonist";
  if (/lipase/.test(t)) return "Lipase inhibitor";
  if (/cannabinoid|\bcb-?1\b/.test(t)) return "CB1 receptor antagonist";
  if (/sodium\/glucose cotransporter 2|sglt-?2/.test(t)) return "SGLT2 inhibitor";
  if (/biguanide/.test(t)) return "Biguanide";
  if (/activin/.test(t)) return "Activin type II receptor antibody";
  if (/sympathomimetic|anorectic|amphetamine/.test(t)) return "Sympathomimetic amine";
  if (/dipeptidyl peptidase|dpp-?4/.test(t)) return "DPP-4 inhibitor";
  if (/fgf-?21|fibroblast growth factor 21/.test(t)) return "FGF21 analogue";
  if (/serotonin 2c|5-ht2c/.test(t)) return "5-HT2C receptor agonist";
  if (/thyroid hormone receptor/.test(t)) return "THR-beta agonist";
  if (/peptide yy|\bpyy\b|neuropeptide y/.test(t)) return "PYY / NPY pathway";
  return null;
}

const CLASS_OF: [RegExp, string][] = [
  [/GLP-1|GIP|glucagon/i, "Incretin-based therapy"],
  [/amylin/i, "Amylin-based therapy"],
  [/MC4R/i, "Melanocortin pathway"],
  [/lipase/i, "Peripherally acting anti-obesity agent"],
  [/CB1|sympathomimetic|5-HT2C/i, "Centrally acting anti-obesity agent"],
  [/SGLT2|biguanide|DPP-4/i, "Antidiabetic"],
  [/activin/i, "Muscle-preserving (activin pathway)"],
  [/FGF21|THR-beta/i, "Metabolic / liver-directed"],
  [/PYY|NPY/i, "Gut-hormone pathway"],
];
export const classOf = (subclass: string): string | null => CLASS_OF.find(([re]) => re.test(subclass))?.[1] ?? null;

// --------------------------------------------------------------------------- #
// Indication names
// --------------------------------------------------------------------------- #
export function normalizeCondition(c: string): string[] {
  const one = normalizeOne(c);
  if (one === "Overweight / obesity") return ["Obesity", "Overweight"];
  return one ? [one] : [];
}

function normalizeOne(c: string): string | null {
  const s = c.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const l = s.toLowerCase();
  if (/type ?(2|ii) diabet|diabetes mellitus,? type ?(2|ii)|\bt2dm?\b|non-insulin-dependent/.test(l)) return "Type 2 diabetes";
  if (/type ?(1|i) diabet|diabetes mellitus,? type ?(1|i)\b|\bt1dm?\b/.test(l)) return "Type 1 diabetes";
  if (/steatohepatitis|\bnash\b|\bmash\b/.test(l)) return "MASH (NASH)";
  if (/fatty liver|\bnafld\b|\bmasld\b/.test(l)) return "Fatty liver disease (MASLD)";
  if (/sleep apn/.test(l)) return "Obstructive sleep apnea";
  if (/polycystic ovar|\bpcos\b/.test(l)) return "Polycystic ovary syndrome";
  if (/heart failure/.test(l)) return "Heart failure";
  if (/knee osteoarthritis|osteoarthritis,? knee/.test(l)) return "Knee osteoarthritis";
  if (/prader/.test(l)) return "Prader-Willi syndrome";
  if (/hypothalamic obesity/.test(l)) return "Hypothalamic obesity";
  if (/weight management|management of (body )?weight|weight (loss|reduction)|body weight (loss|reduction)/.test(l)) return "Weight management";
  if (/^(obesity|obese|obesity, morbid|morbid obesity|severe obesity|adult obesity|obesity in adults)$/.test(l)) return "Obesity";
  if (/^(overweight|over weight)$/.test(l)) return "Overweight";
  if (/^(overweight (and|or|&|\/) obesity|obesity (and|or|&|\/) overweight|overweight or obese|overweight and obese)$/.test(l))
    return "Overweight / obesity";
  if (/^(pediatric|paediatric|childhood|adolescent) obesity|obesity,? (pediatric|childhood|adolescent)/.test(l))
    return "Pediatric obesity";
  if (/^healthy( volunteers?| subjects?| participants?)?$/.test(l)) return "Healthy volunteers";
  return sentence(s.length > 60 ? s.slice(0, 57) + "…" : s);
}

// --------------------------------------------------------------------------- #
// Derivation (pure: easy to test)
// --------------------------------------------------------------------------- #
export interface TrialFact {
  phase: string | null;
  sponsor: string | null;
  sponsorClass: string | null;
  conditions: string[];
  names: string[];               // raw intervention names that name THIS product
  soleNames?: string[];          // ... and name nothing else (safe for code names)
  title?: string | null;         // registry brief title, e.g. "A Study of Enicepatide (CT-388) in ..."
  otherNames?: string[];         // ClinicalTrials.gov "other names" of this drug's interventions
  status: string | null;
  start: string | null;          // YYYY-MM[-DD]
}

export interface PipelineAlias { alias: string; company: string }

/** A conference abstract (e.g. ADA 2026) that names this drug. */
export interface AbstractFact {
  source: string;                // "ADA 2026"
  sponsor: string | null;
  indication: string | null;
  stage: string | null;          // "Clinical – Phase 2b" | "Preclinical – in vivo" | ...
  mechanism: string | null;
  program?: string | null;
  aliases: string[];
  solo: boolean;                 // the abstract is about this drug alone (not a combination / comparison)
}

/** "Clinical – Phase 1b/2a" -> Phase 1/2, "Preclinical – in vivo" -> Preclinical; null when not stated. */
export function phaseFromStage(stage: string | null | undefined): { level: number; label: string } | null {
  const s = (stage ?? "").toLowerCase();
  if (!s) return null;
  if (s.startsWith("preclinical")) return { level: 0, label: "Preclinical" };
  const m = /phase\s*(\d)\s*[ab]?(?:\s*\/\s*(?:phase\s*)?(\d))?/.exec(s);
  if (m) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
    return b && b > a ? { level: b, label: `Phase ${a}/${b}` } : { level: a, label: `Phase ${a}` };
  }
  if (/first[- ]in[- ]human|\bfih\b/.test(s)) return { level: 1, label: "Phase 1" };
  return null;
}

/** The developing company named by an abstract; null for academic / unstated sponsors. */
export function industrySponsor(s: string | null | undefined): string | null {
  const x = (s ?? "").replace(/\s*\(inferred\)\s*$/i, "").replace(/\s*\(with [^)]*\)\s*$/i, "").trim();
  if (!x) return null;
  if (/^(academic|not stated|unknown)/i.test(x) || /\b(funded|university|institute|national|foundation|association|grant|nih|niddk|rwjf)\b/i.test(x)) return null;
  return x;
}

export interface DeriveInput {
  slug: string;
  name: string;
  trials: TrialFact[];
  aliasKeys: string[];           // alias slugs that fold into this product (built-in + product_aliases)
  pipelineAliases?: PipelineAlias[]; // code names from company pipeline pages
  abstracts?: AbstractFact[];    // conference abstracts naming this drug
  lookup: Lookup | null;
  now?: Date;
}


function topSponsor(trials: TrialFact[], fdaSponsors: string[]): string | null {
  const counts = new Map<string, number>();
  for (const t of trials) {
    if (!t.sponsor || (t.sponsorClass ?? "").toUpperCase() !== "INDUSTRY") continue;
    counts.set(t.sponsor, (counts.get(t.sponsor) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // The FDA applicant, written the way the trials write it ("NOVO" -> "Novo Nordisk A/S").
  for (const f of fdaSponsors) {
    const first = f.split(/\s+/)[0]?.toLowerCase();
    const hit = first && first.length >= 3 ? ranked.find(([s]) => s.toLowerCase().startsWith(first)) : undefined;
    if (hit) return hit[0];
  }
  const total = ranked.reduce((n, [, c]) => n + c, 0);
  if (ranked.length && ranked[0][1] >= 2 && ranked[0][1] / total >= 0.4) return ranked[0][0];
  if (ranked.length === 1) return ranked[0][0];
  if (fdaSponsors.length === 1) return titleCase(fdaSponsors[0]);
  return null;
}

function topIndications(trials: TrialFact[]): string | null {
  const counts = new Map<string, number>();
  for (const t of trials) {
    const seen = new Set<string>();
    for (const c of t.conditions) for (const n of normalizeCondition(c)) seen.add(n);
    for (const n of seen) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) return null;
  const floor = trials.length < 5 ? 1 : Math.max(2, Math.ceil(trials.length * 0.08));
  const picked = ranked.filter(([, c], i) => i === 0 || c >= floor).slice(0, 4).map(([n]) => n);
  return picked.join(", ");
}

const ROUTE_WORDS: [RegExp, string][] = [
  [/subcutaneous|\bs\.?c\.?\b|\bsc\b|sub-?q|autoinjector|pen[- ]?injector|\bpen\b/i, "Subcutaneous"],
  [/\boral(ly)?\b|tablet|capsule|\bpo\b/i, "Oral"],
  [/intravenous|\bi\.?v\.?\b|infusion/i, "Intravenous"],
  [/intramuscular|\bi\.?m\.?\b/i, "Intramuscular"],
  [/intranasal|nasal spray/i, "Intranasal"],
  [/transdermal|patch/i, "Transdermal"],
  [/injection|injectable/i, "Injection"],
];

function routesFromNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of uniqText(names)) {
    // A specific route wins over the generic word "injection" in the same name.
    const hits = ROUTE_WORDS.filter(([re]) => re.test(n)).map(([, r]) => r);
    for (const r of hits.length > 1 ? hits.filter((h) => h !== "Injection") : hits) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  // "Injection" only adds something when no injected route is named.
  return ranked.includes("Subcutaneous") || ranked.includes("Intravenous") || ranked.includes("Intramuscular")
    ? ranked.filter((r) => r !== "Injection") : ranked;
}

function phaseLabelFromTrials(trials: TrialFact[]): { level: number; label: string } | null {
  let max = 0;
  for (const t of trials) max = Math.max(max, phaseLevel(t.phase));
  if (!max) return null;
  const atMax = trials.filter((t) => phaseLevel(t.phase) === max);
  const onlyCombined = atMax.every((t) => (t.phase ?? "").split(",").length > 1);
  return { level: max, label: onlyCombined && max > 1 ? `Phase ${max - 1}/${max}` : `Phase ${max}` };
}

/** Drug-name endings of INNs (international non-proprietary names) worth keeping as aliases. */
const INN_STEM_RE = /^[a-z]{4,}(tide|glutide|glipron|lintide|mab|siran|rsen|gliflozin|gliptin)$/i;

/** Alias-worthy parts of one "other name": code names and INN-style drug names. */
export function aliasCandidates(other: string): string[] {
  const out: string[] = [];
  const s = other.trim();
  if (!s || /placebo|vehicle|saline|matching/i.test(s)) return out;
  for (const m of s.toUpperCase().matchAll(CODE_TOKEN_RE)) {
    const start = m.index ?? 0;
    out.push(s.slice(start, start + m[0].length).toUpperCase());
  }
  for (const w of s.split(/[\s,;/()]+/)) if (INN_STEM_RE.test(w)) out.push(titleCase(w));
  return out;
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Aliases written next to the drug name in trial titles: "Name (CT-388)" / "CT-388 (Name)". */
export function titleAliases(name: string, titles: string[]): string[] {
  if (name.includes(" + ") || name.length < 3) return [];
  const n = escapeRe(name);
  const after = new RegExp(`\\b${n}\\s*\\(([^()]{2,40})\\)`, "gi");
  const before = new RegExp(`([A-Za-z][A-Za-z0-9-]{1,30})\\s*\\(\\s*${n}\\s*\\)`, "gi");
  const out: string[] = [];
  for (const t of titles) {
    if (!t) continue;
    for (const m of t.matchAll(after)) out.push(...aliasCandidates(m[1]));
    for (const m of t.matchAll(before)) out.push(...aliasCandidates(m[1]));
  }
  return out;
}

export function deriveAuto(input: DeriveInput): AutoInfo {
  const out: AutoInfo = {};
  const set = (k: InfoField, value: string | null | undefined, source: string) => {
    const v = (value ?? "").trim();
    if (v) out[k] = { value: v.slice(0, 500), source };
  };
  const { trials, lookup } = input;
  const undisclosed = isUndisclosedProduct(input.slug);
  const parts = input.name.split(" + ").map((s) => s.trim()).filter(Boolean);
  const combo = parts.length > 1;
  const chembl = (lookup?.chembl ?? []).filter((c): c is ChemblInfo => !!c);
  const single = !combo ? chembl[0] ?? null : null;
  const fda = lookup?.fda ?? null;
  const inx = (lookup?.inxight ?? []).filter((c): c is InxightInfo => !!c);
  const singleInx = !combo ? inx[0] ?? null : null;
  const inxStatus = singleInx?.status ?? "";
  const abstracts = input.abstracts ?? [];
  const soloAbs = abstracts.filter((a) => a.solo);
  // A drug known only from abstracts: what the abstracts say about its program is all we have.
  const ownAbs = trials.length ? soloAbs : abstracts;
  const absSrc = (a: AbstractFact) => `${a.source} abstract`;
  const now = input.now ?? new Date();

  // Approval -------------------------------------------------------------------
  const phase4Trial = trials.some((t) => phaseLevel(t.phase) === 4);
  let approved: AutoValue | null = null;
  if (fda) approved = { value: "Yes", source: "openFDA" };
  else if (/^US (Approved (Rx|OTC)|Previously Marketed)$/i.test(inxStatus)) approved = { value: "Yes", source: "Inxight Drugs" };
  else if (!combo && single && single.maxPhase !== null && single.maxPhase >= 4) approved = { value: "Yes", source: "ChEMBL" };
  else if (combo && chembl.length === parts.length && chembl.every((c) => (c.maxPhase ?? 0) >= 4) && phase4Trial)
    approved = { value: "Yes", source: "ChEMBL + trials" };
  else if (!combo && single) approved = { value: "No", source: "ChEMBL" };
  else if (/^(Clinical|Discontinued|Designated)$/i.test(inxStatus)) approved = { value: "No", source: "Inxight Drugs" };
  else if (!undisclosed && phase4Trial) approved = { value: "Yes", source: "Trials (Phase 4)" };
  if (approved) set("approved", approved.value, approved.source);
  const isApproved = approved?.value === "Yes";
  const withdrawn = !!single?.withdrawn || /^withdrawn$/i.test(inxStatus);

  if (fda?.firstApproval) set("approval_date", fda.firstApproval, "openFDA (first US approval)");
  else if (isApproved && singleInx?.approvalYear) set("approval_date", String(singleInx.approvalYear), "Inxight Drugs (approval year)");
  else if (isApproved && single?.firstApproval) set("approval_date", String(single.firstApproval), "ChEMBL (first approval year)");

  // Phase ------------------------------------------------------------------------
  const tp = phaseLabelFromTrials(trials);
  const activeTrial = trials.some((t) => /RECRUITING|ACTIVE|ENROLLING/i.test(t.status ?? ""));
  if (withdrawn) set("phase", "Withdrawn", single?.withdrawn ? "ChEMBL" : "Inxight Drugs");
  else if (isApproved) set("phase", "Approved", approved!.source);
  else if (/^discontinued$/i.test(inxStatus) && !activeTrial) set("phase", "Discontinued", "Inxight Drugs");
  else {
    const cp = single?.maxPhase != null ? Math.floor(single.maxPhase) : 0;
    const ip = inxightPhaseLevel(singleInx?.highestPhase);
    const best = Math.max(cp, ip);
    // The most advanced stage a conference abstract reports for this drug alone.
    const ab = ownAbs.map((a) => ({ p: phaseFromStage(a.stage), a }))
      .filter((x): x is { p: { level: number; label: string }; a: AbstractFact } => !!x.p)
      .sort((x, y) => y.p.level - x.p.level)[0];
    if (best >= 1 && best < 4 && (!tp || best > tp.level) && (!ab || best >= ab.p.level)) set("phase", `Phase ${best}`, cp >= ip ? "ChEMBL" : "Inxight Drugs");
    else if (ab && ab.p.level >= 1 && ab.p.level < 4 && (!tp || ab.p.level > tp.level)) set("phase", ab.p.label, absSrc(ab.a));
    else if (tp && tp.level < 4) set("phase", tp.label, "Trials");
    else if (ab && !tp) set("phase", ab.p.label, absSrc(ab.a)); // "Preclinical"
  }

  // Company -------------------------------------------------------------------
  if (fda && fda.generics >= 3 && !trials.some((t) => (t.sponsorClass ?? "").toUpperCase() === "INDUSTRY")) {
    set("sponsor", "Generic (several companies)", "openFDA");
  } else {
    const s = topSponsor(trials, fda?.sponsors ?? []);
    if (s) set("sponsor", s, trials.some((t) => t.sponsor === s) ? "Trials" : "openFDA");
  }

  if (!out.sponsor) {
    const counts = new Map<string, { n: number; src: string }>();
    for (const a of ownAbs) {
      const s = industrySponsor(a.sponsor);
      if (s) counts.set(s, { n: (counts.get(s)?.n ?? 0) + 1, src: absSrc(a) });
    }
    const top = [...counts].sort((x, y) => y[1].n - x[1].n)[0];
    if (top) set("sponsor", top[0], top[1].src);
  }

  // Pipeline / non-pipeline ----------------------------------------------------
  // Pipeline = a drug a company is developing (industry); Non-pipeline = an academic
  // drug (only universities / hospitals / public funders run its trials, or a generic
  // with no single developing company). Decided by who sponsors the drug's trials.
  const industryTrials = trials.filter((t) => (t.sponsorClass ?? "").toUpperCase() === "INDUSTRY").length;
  const company = out.sponsor && out.sponsor.value !== "Generic (several companies)" ? out.sponsor.value : null;
  if (company) set("candidate", "Pipeline", `Industry (${company})`);
  else if (!trials.length && abstracts.length) set("candidate", "Non-pipeline", "Academic (conference abstract only)");
  else if (trials.length) {
    set("candidate", "Non-pipeline",
      out.sponsor ? "Generic, no developing company"
        : industryTrials ? "Academic (no single developing company)" : "Academic (no industry-sponsored trials)");
  }

  // Indication -----------------------------------------------------------------
  set("indication", topIndications(trials), "Trials");
  if (!out.indication && ownAbs.some((a) => a.indication)) {
    const a = ownAbs.find((x) => x.indication)!;
    set("indication", uniqText(normalizeCondition(a.indication!)).join(", "), absSrc(a));
  }
  if (!out.indication && singleInx?.conditions.length) {
    set("indication", uniqText(singleInx.conditions.flatMap(normalizeCondition)).slice(0, 3).join(", "), "Inxight Drugs");
  }

  // Combination parts ----------------------------------------------------------
  if (combo) set("parent_drug", parts.join(", "), "Drug name");

  // Code names (aliases) --------------------------------------------------------
  // Sources in order of trust; the first spelling seen wins ("CT-388" over "CT388").
  const codes: { v: string; src: string }[] = [];
  const ownSlug = slugify(input.name);
  // 0) The developer's own pipeline page, then ChEMBL.
  for (const pa of input.pipelineAliases ?? []) codes.push({ v: pa.alias, src: `Company pipeline (${pa.company})` });
  for (const c of chembl) for (const x of c.codes) codes.push({ v: x, src: "ChEMBL" });
  for (const c of inx) for (const x of c.codes) codes.push({ v: x, src: "Inxight Drugs" });
  // 1) ClinicalTrials.gov "other names" registered for this drug's interventions.
  for (const t of trials) for (const o of t.otherNames ?? []) {
    for (const a of aliasCandidates(o)) codes.push({ v: a, src: "ClinicalTrials.gov" });
  }
  // 2) Trial titles: "Enicepatide (CT-388)" or "CT-388 (Enicepatide)".
  for (const a of titleAliases(input.name, trials.map((t) => t.title ?? ""))) codes.push({ v: a, src: "Trial titles" });
  for (const a of abstracts) for (const x of a.aliases) codes.push({ v: isCode(x) ? x.toUpperCase() : x, src: absSrc(a) });
  // 3) A code written next to this drug alone in intervention names ("Tirzepatide (LY3298176)") in 2+ trials.
  const codeTrials = new Map<string, { v: string; n: number }>();
  for (const t of trials) {
    const inTrial = new Map<string, string>();
    for (const n of t.soleNames ?? []) {
      if (/\b(pen|device|injector|autoinjector|administered by|formulation)\b/i.test(n)) continue; // device codes
      for (const m of n.toUpperCase().matchAll(CODE_TOKEN_RE)) inTrial.set(slugify(m[0]), m[0]);
    }
    for (const [k, v] of inTrial) codeTrials.set(k, { v: codeTrials.get(k)?.v ?? v, n: (codeTrials.get(k)?.n ?? 0) + 1 });
  }
  for (const { v, n } of codeTrials.values()) if (n >= 2) codes.push({ v, src: "Trials" });
  // 4) The built-in alias list and merges made on the website.
  for (const k of input.aliasKeys) if (isCode(k) || INN_STEM_RE.test(k)) codes.push({ v: isCode(k) ? k.toUpperCase() : titleCase(k), src: "Alias list" });
  const codeList = uniqBy(codes, (c) => slugify(c.v)).filter((c) => slugify(c.v) !== ownSlug && slugify(c.v) !== input.slug).slice(0, 8);
  if (codeList.length) {
    // "Company pipeline (Roche) + Company pipeline (Zealand)" -> "Company pipeline (Roche, Zealand)"
    const companies = [...new Set(codeList.map((c) => /^Company pipeline \((.*)\)$/.exec(c.src)?.[1]).filter((x): x is string => !!x))];
    const others = [...new Set(codeList.map((c) => c.src).filter((x) => !x.startsWith("Company pipeline")))];
    set("aliases", codeList.map((c) => c.v).join(", "),
      [...(companies.length ? [`Company pipeline (${companies.join(", ")})`] : []), ...others].join(" + "));
  }

  // Brand names ----------------------------------------------------------------
  const brands: { v: string; src: string }[] = [];
  for (const b of fda?.brands ?? []) brands.push({ v: titleCase(b), src: "openFDA" });
  for (const b of singleInx?.brands ?? []) brands.push({ v: titleCase(b), src: "Inxight Drugs" });
  for (const [k, ref] of Object.entries(BUILTIN_ALIASES))
    if (ref.slug === input.slug && !/\d/.test(k)) brands.push({ v: k.charAt(0).toUpperCase() + k.slice(1), src: "Alias list" });
  if (!combo) for (const b of single?.tradeNames ?? []) brands.push({ v: titleCase(b), src: "ChEMBL" });
  const partSlugs = new Set(parts.map((p) => slugify(p)));
  const brandList = uniqBy(brands, (b) => slugify(b.v))
    .filter((b) => !partSlugs.has(slugify(b.v)) && !parts.some((p) => slugify(b.v).startsWith(slugify(p))))
    .slice(0, 6);
  if (brandList.length) set("brand_names", brandList.map((b) => b.v).join(", "), [...new Set(brandList.map((b) => b.src))].join(" + "));

  // Mechanism ------------------------------------------------------------------
  const mechs = uniqText(chembl.flatMap((c) => c.mechanisms.map((m) => sentence(m.moa))));
  const fdaMoa = uniqText((fda?.moa ?? []).map((m) => m.replace(/\s*\[MoA\]\s*$/i, "")));
  const inxMoaOf = (c: InxightInfo) => c.targets.map((t) => sentence(t.target.toLowerCase()) + (t.action ? ` ${t.action}` : ""));
  const inxMoa = uniqText(inx.flatMap(inxMoaOf));
  if (mechs.length) set("moa", mechs.join("; "), "ChEMBL");
  else if (inxMoa.length) set("moa", inxMoa.join("; "), "Inxight Drugs");
  else if (fdaMoa.length) set("moa", fdaMoa.join("; "), "openFDA");
  const absMech = soloAbs.find((a) => a.mechanism);
  if (!out.moa && absMech) set("moa", absMech.mechanism, absSrc(absMech));

  // Therapy subclass / class -----------------------------------------------------
  const isSmall = !combo && (single ? (single.type ?? "").toLowerCase() === "small molecule" : singleInx?.substanceClass === "chemical");
  const fdaEpc = (fda?.epc ?? []).map((e) => e.replace(/\s*\[EPC\]\s*$/i, "")).join("; ");
  let sub: AutoValue | null = null;
  const fromMech = subclassFrom(mechs.join("; "), isSmall);
  if (combo) {
    // A combination: the parts' classes ("GLP-1 receptor agonist + Amylin analogue").
    const perPart = chembl.map((c) => subclassFrom(c.mechanisms.map((m) => m.moa).join("; "), (c.type ?? "").toLowerCase() === "small molecule"));
    const joined = uniqText(perPart.filter((x): x is string => !!x));
    if (joined.length) sub = { value: joined.join(" + "), source: "ChEMBL" };
    else {
      const ip = uniqText(inx.map((c) => subclassFrom(inxMoaOf(c).join("; "), c.substanceClass === "chemical") ?? "").filter(Boolean));
      if (ip.length) sub = { value: ip.join(" + "), source: "Inxight Drugs" };
    }
  } else if (fromMech) sub = { value: fromMech, source: "ChEMBL" };
  else if (inxMoa.length && subclassFrom(inxMoa.join("; "), isSmall)) sub = { value: subclassFrom(inxMoa.join("; "), isSmall)!, source: "Inxight Drugs" };
  if (!sub && fdaEpc) {
    const s = subclassFrom(fdaEpc, isSmall);
    sub = { value: s ?? fdaEpc.split("; ")[0], source: "openFDA" };
  }
  if (!sub && absMech && !combo) {
    const s = subclassFrom(absMech.mechanism!, /small[- ]molecule|non-?peptide/i.test(absMech.mechanism!));
    if (s) sub = { value: s, source: absSrc(absMech) };
  }
  if (!sub) {
    const s = subclassFrom(input.name);
    if (s) sub = { value: s, source: "Drug name" };
  }
  if (sub) {
    set("therapy_subclass", sub.value, sub.source);
    const cls = uniqText(sub.value.split(" + ").map((x) => classOf(x) ?? "").filter(Boolean));
    if (cls.length) set("drug_class", cls.join(" + "), sub.source);
  }

  // Modality -------------------------------------------------------------------
  const peptideLike = /tide$/i.test(input.name) || /GLP-1|GIP|glucagon|amylin|MC4R/.test(sub?.value ?? "");
  if (combo) set("modality", "Combination", "Drug name");
  else if (single?.type) {
    const t = single.type.toLowerCase();
    const m =
      t === "small molecule" ? "Small molecule"
      : t === "antibody" ? "Monoclonal antibody"
      : t === "oligonucleotide" ? "Oligonucleotide (siRNA / ASO)"
      : t === "gene" ? "Gene therapy"
      : t === "cell" ? "Cell therapy"
      : t === "protein" || t === "enzyme" ? (peptideLike ? "Peptide" : "Protein / biologic")
      : null;
    if (m) set("modality", m, "ChEMBL");
  }
  if (!out.modality && singleInx?.substanceClass) {
    const c = singleInx.substanceClass.toLowerCase();
    const m =
      c === "chemical" ? (/tide$/i.test(input.name) ? "Peptide" : "Small molecule") // cyclic peptides are filed as chemicals
      : c === "protein" ? (/mab$/i.test(input.name) ? "Monoclonal antibody" : peptideLike ? "Peptide" : "Protein / biologic")
      : c === "nucleicacid" ? "Oligonucleotide (siRNA / ASO)"
      : null;
    if (m) set("modality", m, "Inxight Drugs");
  }
  if (!out.modality && absMech) {
    const t = absMech.mechanism!;
    const m =
      /\b(si|sa)rna\b|oligonucleotide|antisense/i.test(t) ? "Oligonucleotide (siRNA / ASO)"
      : /antibod|\bmab\b/i.test(t) ? "Monoclonal antibody"
      : /gene therapy|\baav\b/i.test(t) ? "Gene therapy"
      : /small[- ]molecule|non-?peptide/i.test(t) ? "Small molecule"
      : /peptide|analogue|analog\b/i.test(t) ? "Peptide"
      : null;
    if (m) set("modality", m, absSrc(absMech));
  }
  if (!out.modality && !undisclosed) {
    const n = input.name.toLowerCase();
    if (/mab$/.test(n)) set("modality", "Monoclonal antibody", "Drug name (INN stem)");
    else if (/(glutide|tide)$/.test(n)) set("modality", "Peptide", "Drug name (INN stem)");
    else if (/(glipron|gliflozin|gliptin)$/.test(n)) set("modality", "Small molecule", "Drug name (INN stem)");
    else if (/siran$|rsen$/.test(n)) set("modality", "Oligonucleotide (siRNA / ASO)", "Drug name (INN stem)");
  }

  // Route ----------------------------------------------------------------------
  const fdaRoutes = uniqText((fda?.routes ?? []).map(titleCase));
  const nameRoutes = routesFromNames(trials.flatMap((t) => t.names));
  if (fdaRoutes.length) set("roa", fdaRoutes.join(", "), "openFDA");
  else if (nameRoutes.length) set("roa", nameRoutes.slice(0, 2).join(", "), "Trials (intervention names)");
  else if (single?.oral && !single.parenteral) set("roa", "Oral", "ChEMBL");
  else if (single?.parenteral && !single.oral) set("roa", "Injection", "ChEMBL");
  const oralAbs = soloAbs.find((a) => /\boral\b/i.test(`${a.mechanism ?? ""} ${a.program ?? ""}`));
  if (!out.roa && oralAbs) set("roa", "Oral", absSrc(oralAbs));

  return out;
}

// --------------------------------------------------------------------------- #
// HTTP
// --------------------------------------------------------------------------- #
class SourceDown extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON. null = "not found" (404); throws SourceDown after retries on 429/5xx/network errors. */
async function getJson(url: string): Promise<any | null> {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "obesity-trials-platform/1.0 (drug-profile autofill)" },
        signal: AbortSignal.timeout(enrichConfig.timeoutMs),
      });
      // 404 = nothing found; 400 = a query this service doesn't accept: treat as "not found".
      if (res.status === 404 || res.status === 400) return null;
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) throw new SourceDown(`${last} for ${url}`);
    } catch (e) {
      if (e instanceof SourceDown) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new SourceDown(`${last} for ${url}`);
}

// --------------------------------------------------------------------------- #
// ChEMBL
// --------------------------------------------------------------------------- #
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseChemblMolecule(m: any, mechanisms: any[]): ChemblInfo {
  const syns: any[] = Array.isArray(m?.molecule_synonyms) ? m.molecule_synonyms : [];
  const synOf = (type: string) =>
    uniqText(syns.filter((s) => String(s?.syn_type ?? "").toUpperCase() === type).map((s) => String(s?.molecule_synonym ?? "")));
  return {
    id: String(m?.molecule_chembl_id ?? ""),
    name: m?.pref_name ?? null,
    type: m?.molecule_type ?? null,
    maxPhase: num(m?.max_phase),
    firstApproval: num(m?.first_approval),
    oral: m?.oral === true,
    parenteral: m?.parenteral === true,
    topical: m?.topical === true,
    withdrawn: m?.withdrawn_flag === true,
    tradeNames: synOf("TRADE_NAME").slice(0, 12),
    codes: synOf("RESEARCH_CODE").slice(0, 12),
    mechanisms: uniqBy(
      mechanisms
        .filter((x) => x?.mechanism_of_action)
        .map((x) => ({ moa: String(x.mechanism_of_action), action: x.action_type ? String(x.action_type) : null })),
      (x) => x.moa.toLowerCase(),
    ),
  };
}

/** Name variants worth trying: as written, and a code with a hyphen ("HRS9531" -> "HRS-9531"). */
function nameVariants(name: string): string[] {
  const v = [name.trim()];
  const m = /^([A-Za-z]{1,6})-?\s?(\d[A-Za-z0-9]*)$/.exec(name.trim());
  if (m) v.push(`${m[1]}-${m[2]}`, `${m[1]}${m[2]}`);
  return [...new Set(v.map((x) => x.toUpperCase()))];
}

export async function chemblByName(name: string): Promise<ChemblInfo | null> {
  const base = enrichConfig.chemblBase;
  const enc = encodeURIComponent;
  let found: any[] = [];
  for (const v of nameVariants(name)) {
    for (const filter of ["pref_name__iexact", "molecule_synonyms__molecule_synonym__iexact"]) {
      const r = await getJson(`${base}/molecule.json?${filter}=${enc(v)}&limit=5`);
      await sleep(enrichConfig.delayMs);
      found = Array.isArray(r?.molecules) ? r.molecules : [];
      if (found.length) break;
    }
    if (found.length) break;
  }
  if (!found.length) return null;
  // Prefer the parent compound (not a salt) and the most advanced record.
  found.sort((a, b) => (num(b?.max_phase) ?? -1) - (num(a?.max_phase) ?? -1));
  let mol = found[0];
  const parentId = mol?.molecule_hierarchy?.parent_chembl_id;
  if (parentId && parentId !== mol?.molecule_chembl_id) {
    const p = await getJson(`${base}/molecule/${enc(parentId)}.json`);
    await sleep(enrichConfig.delayMs);
    if (p?.molecule_chembl_id) mol = { ...p, max_phase: num(p.max_phase) ?? mol.max_phase };
  }
  const ids = [...new Set([mol.molecule_chembl_id, ...found.map((f) => f?.molecule_chembl_id)].filter(Boolean))].slice(0, 5);
  const mr = await getJson(`${base}/mechanism.json?molecule_chembl_id__in=${ids.map(enc).join(",")}&limit=50`);
  await sleep(enrichConfig.delayMs);
  return parseChemblMolecule(mol, Array.isArray(mr?.mechanisms) ? mr.mechanisms : []);
}

// --------------------------------------------------------------------------- #
// openFDA
// --------------------------------------------------------------------------- #
const fdaDate = (d: unknown) => {
  const s = String(d ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

/** Keep only FDA products whose active ingredients are exactly these parts (salts allowed). */
export function parseFda(results: any[], parts: string[]): FdaInfo | null {
  const want = parts.map((p) => p.toUpperCase());
  const brandsNda: string[] = [], brandsOther: string[] = [], discontinued: string[] = [];
  const routes: string[] = [], sponsors: string[] = [], epc: string[] = [], moa: string[] = [];
  let first: string | null = null, generics = 0, marketed = false, any = false;
  for (const app of results ?? []) {
    const prods = (Array.isArray(app?.products) ? app.products : []).filter((p: any) => {
      const ings: string[] = (Array.isArray(p?.active_ingredients) ? p.active_ingredients : []).map((i: any) => String(i?.name ?? "").toUpperCase());
      return ings.length === want.length && want.every((w) => ings.some((i) => i.includes(w)));
    });
    if (!prods.length) continue;
    any = true;
    const appNo = String(app?.application_number ?? "").toUpperCase();
    const isGeneric = appNo.startsWith("ANDA");
    if (isGeneric) generics++;
    else if (app?.sponsor_name) sponsors.push(String(app.sponsor_name));
    for (const p of prods) {
      const b = String(p?.brand_name ?? "").trim();
      const stopped = /discontinued/i.test(String(p?.marketing_status ?? ""));
      if (!stopped) marketed = true;
      if (b && !want.some((w) => b.toUpperCase().includes(w))) (stopped ? discontinued : isGeneric ? brandsOther : brandsNda).push(b);
      if (p?.route) routes.push(...String(p.route).split(/,\s*/));
    }
    for (const s of Array.isArray(app?.submissions) ? app.submissions : []) {
      if (String(s?.submission_type).toUpperCase() !== "ORIG" || String(s?.submission_status).toUpperCase() !== "AP") continue;
      const d = fdaDate(s?.submission_status_date);
      if (d && (!first || d < first)) first = d;
    }
    epc.push(...(app?.openfda?.pharm_class_epc ?? []));
    moa.push(...(app?.openfda?.pharm_class_moa ?? []));
  }
  if (!any) return null;
  return {
    brands: uniqText([...brandsNda, ...brandsOther, ...discontinued]).slice(0, 10),
    routes: uniqText(routes),
    firstApproval: first,
    sponsors: uniqText(sponsors),
    generics,
    marketed,
    epc: uniqText(epc),
    moa: uniqText(moa),
  };
}

/** Products sold under this brand name (any ingredients), e.g. "Micardis" -> telmisartan. */
export function parseFdaBrand(results: any[], brand: string): FdaInfo | null {
  const want = brand.toUpperCase();
  const keep = (results ?? []).map((app: any) => ({
    ...app,
    products: (Array.isArray(app?.products) ? app.products : []).filter((p: any) => String(p?.brand_name ?? "").toUpperCase() === want),
  })).filter((app: any) => app.products.length);
  if (!keep.length) return null;
  const ings = [...new Set(keep.flatMap((a: any) => a.products.flatMap((p: any) =>
    (p.active_ingredients ?? []).map((i: any) => String(i?.name ?? "").replace(/\s+(HYDROCHLORIDE|SODIUM|POTASSIUM|ACETATE|MESYLATE|MALEATE|TARTRATE|SUCCINATE|CITRATE|SULFATE|PHOSPHATE)$/i, "")))))] as string[];
  return parseFda(keep, ings.length ? ings : [want]);
}

export async function fdaByParts(parts: string[]): Promise<FdaInfo | null> {
  const q = parts
    .map((p) => encodeURIComponent(`products.active_ingredients.name:"${p.toUpperCase().replace(/"/g, "")}"`))
    .join("+AND+");
  const key = enrichConfig.fdaKey ? `&api_key=${encodeURIComponent(enrichConfig.fdaKey)}` : "";
  const r = await getJson(`${enrichConfig.fdaBase}/drug/drugsfda.json?search=${q}&limit=1000${key}`);
  await sleep(Math.max(enrichConfig.delayMs, 300)); // openFDA: max 240 requests/minute
  const byIngredient = parseFda(Array.isArray(r?.results) ? r.results : [], parts);
  if (byIngredient || parts.length !== 1) return byIngredient;
  // Not an ingredient name: maybe a US brand name ("Micardis", "Qsymia").
  const bq = encodeURIComponent(`products.brand_name:"${parts[0].toUpperCase().replace(/"/g, "")}"`);
  const b = await getJson(`${enrichConfig.fdaBase}/drug/drugsfda.json?search=${bq}&limit=100${key}`);
  await sleep(Math.max(enrichConfig.delayMs, 300));
  return parseFdaBrand(Array.isArray(b?.results) ? b.results : [], parts[0]);
}

// --------------------------------------------------------------------------- #
// NCATS Inxight Drugs (drugs.ncats.io): public JSON API of the NIH substance registry
// --------------------------------------------------------------------------- #
/** "Phase II" -> 2, "Approved" / "Phase IV" -> 4. */
export function inxightPhaseLevel(p: string | null | undefined): number {
  const s = (p ?? "").trim().toUpperCase();
  if (s === "APPROVED") return 4;
  const m = /^PHASE\s+(IV|III|II|I|[1-4])\b/.exec(s);
  if (!m) return 0;
  return ({ I: 1, II: 2, III: 3, IV: 4 } as Record<string, number>)[m[1]] ?? Number(m[1]);
}

const bareName = (n: string) => n.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
const nameKey = (n: string) => slugify(bareName(n));

/**
 * The substance record that IS this drug among search results (a name search also returns
 * salts, fragments and intermediates): its display name, else the one active moiety that
 * carries the name. null when nothing (or more than one thing) fits.
 */
export function pickInxight(content: any[], name: string): any | null {
  const want = nameKey(name);
  if (!want) return null;
  const isMoiety = (c: any) => (c?.relationships ?? []).some((r: any) =>
    r?.type === "ACTIVE MOIETY" && r?.relatedSubstance?.approvalID && r.relatedSubstance.approvalID === c?.approvalID);
  const exact = (content ?? []).filter((c) => nameKey(String(c?._name ?? "")) === want);
  if (exact.length) return exact.find(isMoiety) ?? exact[0];
  const named = (content ?? []).filter((c) => (c?.names ?? []).some((n: any) => nameKey(String(n?.name ?? "")) === want));
  const moieties = named.filter(isMoiety);
  const pool = moieties.length ? moieties : named;
  return pool.length === 1 ? pool[0] : null;
}

/** One substance record (view=full) + the facet values of that record alone. */
export function parseInxight(rec: any, facets: any[]): InxightInfo {
  const names: any[] = Array.isArray(rec?.names) ? rec.names : [];
  const ofType = (t: string) => uniqText(names.filter((n) => n?.type === t).map((n) => bareName(String(n?.name ?? ""))));
  const facet = (k: string): string[] =>
    ((facets ?? []).find((f: any) => f?.name === k)?.values ?? []).map((v: any) => String(v?.label ?? "")).filter((x: string) => x && x !== "Unknown" && x !== "Not Provided");
  const targets = uniqBy(
    (Array.isArray(rec?.relationships) ? rec.relationships : [])
      .filter((r: any) => /^TARGET->/i.test(String(r?.type ?? "")) && r?.relatedSubstance?.name)
      .map((r: any) => ({ target: String(r.relatedSubstance.name), action: String(r.type).split("->")[1]?.trim().toLowerCase() || null })),
    (t: { target: string; action: string | null }) => `${t.target.toLowerCase()}|${t.action}`,
  );
  // No target relationships: the curated "Primary Target" + "Pharmacology" facets.
  const pharm = facet("Pharmacology");
  if (!targets.length) for (const t of facet("Primary Target")) targets.push({ target: t, action: pharm.length === 1 ? pharm[0].toLowerCase() : null });
  const year = num(facet("Approval Year")[0]);
  return {
    unii: String(rec?.approvalID ?? ""),
    name: bareName(String(rec?._name ?? "")),
    status: facet("Development Status")[0] ?? null,
    highestPhase: facet("Highest Phase").sort((a, b) => inxightPhaseLevel(b) - inxightPhaseLevel(a))[0] ?? null,
    approvalYear: year && year > 1900 ? year : null,
    conditions: facet("Condition").slice(0, 6),
    targets: targets.slice(0, 6),
    substanceClass: rec?.substanceClass ? String(rec.substanceClass) : null,
    codes: ofType("cd").filter(isCode).slice(0, 12),                       // not "XW004 component XW003"
    brands: ofType("bn").filter((b) => !/component|\bkit\b/i.test(b)).slice(0, 10), // not "QSYMIA COMPONENT PHENTERMINE"
  };
}

/** GET JSON from Inxight; a page instead of JSON (its browser check) counts as the service being down. */
async function inxightJson(path: string): Promise<any | null> {
  const url = `${enrichConfig.inxightBase}${path}`;
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(enrichConfig.inxightRetryMs * attempt); // 503 = too quick: back off
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "obesity-trials-platform/1.0 (drug-profile autofill; +https://obesity-trials.vercel.app)" },
        signal: AbortSignal.timeout(enrichConfig.timeoutMs),
      });
      if (res.status === 404 || res.status === 400) return null;
      if (res.ok && /json/i.test(res.headers.get("content-type") ?? "")) return await res.json();
      last = res.ok ? "a web page instead of data (browser check?)" : `HTTP ${res.status}`;
      if (res.ok || (res.status !== 429 && res.status < 500)) throw new SourceDown(`${last} for ${url}`);
    } catch (e) {
      if (e instanceof SourceDown) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new SourceDown(`${last} for ${url}`);
}

export async function inxightByName(name: string): Promise<InxightInfo | null> {
  const enc = encodeURIComponent;
  for (const v of nameVariants(name)) {
    const q = `root_names_name:"${v.replace(/"/g, "")}"`;
    const r = await inxightJson(`/substances/search?q=${enc(q)}&top=10&view=full`);
    await sleep(enrichConfig.inxightDelayMs);
    const rec = pickInxight(Array.isArray(r?.content) ? r.content : [], name);
    if (!rec?.approvalID) continue;
    const f = await inxightJson(`/substances/search?q=${enc(`root_approvalID:"${rec.approvalID}"`)}&top=1&fdim=40`);
    await sleep(enrichConfig.inxightDelayMs);
    return parseInxight(rec, Number(f?.total) === 1 && Array.isArray(f?.facets) ? f.facets : []);
  }
  return null;
}

// --------------------------------------------------------------------------- #
// ClinicalTrials.gov "other names" (code names) of trial interventions
// --------------------------------------------------------------------------- #
/** Parse one CT.gov v2 study into [intervention, otherName] pairs. */
export function otherNamesOf(study: any): { nct: string; intervention: string; other: string }[] {
  const nct = study?.protocolSection?.identificationModule?.nctId;
  const ivs = study?.protocolSection?.armsInterventionsModule?.interventions;
  if (!nct || !Array.isArray(ivs)) return [];
  const out: { nct: string; intervention: string; other: string }[] = [];
  for (const iv of ivs) {
    const name = typeof iv?.name === "string" ? iv.name.trim() : "";
    if (!name || !Array.isArray(iv?.otherNames)) continue;
    for (const o of iv.otherNames) if (typeof o === "string" && o.trim()) out.push({ nct, intervention: name, other: o.trim().slice(0, 200) });
  }
  return out;
}

/** Download the "other names" of every drug trial's interventions (100 trials per request). */
export async function refreshOtherNames(log: (m: string, o?: unknown) => void = () => {}): Promise<{ trials: number; names: number } | null> {
  const ids = (await pool.query<{ nct_id: string }>(
    "SELECT DISTINCT t.nct_id FROM trials t JOIN trial_products tp ON tp.nct_id = t.nct_id WHERE t.is_active ORDER BY 1",
  )).rows.map((r) => r.nct_id);
  const rows: { nct: string; intervention: string; other: string }[] = [];
  const seen = new Set<string>();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const url = `${config.ctgov.baseUrl}/studies?filter.ids=${batch.join(",")}`
        + "&fields=NCTId,InterventionName,InterventionOtherName&pageSize=100&format=json";
      const j = await getJson(url);
      for (const st of Array.isArray(j?.studies) ? j.studies : []) {
        for (const r of otherNamesOf(st)) {
          const k = `${r.nct}\u0000${r.intervention}\u0000${r.other}`;
          if (!seen.has(k)) { seen.add(k); rows.push(r); }
        }
      }
      await sleep(Math.max(enrichConfig.delayMs, 250));
    }
  } catch (e) {
    log("ClinicalTrials.gov other names unavailable — keeping the last copy", String(e));
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM intervention_other_names WHERE nct_id = ANY($1)", [ids]);
    for (let i = 0; i < rows.length; i += 1000) {
      const b = rows.slice(i, i + 1000);
      await client.query(
        `INSERT INTO intervention_other_names (nct_id, intervention, other_name)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING`,
        [b.map((r) => r.nct), b.map((r) => r.intervention), b.map((r) => r.other)],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { trials: ids.length, names: rows.length };
}

// --------------------------------------------------------------------------- #
// Company pipeline pages (sync/data/pipeline-sources.json)
// --------------------------------------------------------------------------- #
export interface PipelineSources {
  pages: { company: string; url: string }[];
  known: { company: string; drug: string; aliases: string[]; url?: string }[];
}

export function loadPipelineSources(): PipelineSources {
  try {
    const j = JSON.parse(readFileSync(new URL("../data/pipeline-sources.json", import.meta.url), "utf8"));
    return { pages: Array.isArray(j.pages) ? j.pages : [], known: Array.isArray(j.known) ? j.known : [] };
  } catch {
    return { pages: [], known: [] };
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", reg: "®", trade: "™", ndash: "–", mdash: "—", middot: "·",
};
const decodeEntities = (x: string) => x
  .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

function flattenStrings(v: unknown, out: string[]) {
  if (typeof v === "string") { if (v.trim()) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => flattenStrings(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => flattenStrings(x, out));
}

/** The text of a web page, one block per line, plus the strings of any embedded JSON data. */
export function pageText(html: string): string {
  const json: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/application\/(ld\+)?json|__NEXT_DATA__|__NUXT_DATA__/i.test(m[1])) {
      try { flattenStrings(JSON.parse(m[2]), json); } catch { /* not JSON */ }
    }
  }
  const body = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(br|p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|span|a|strong|em|button|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(`${body}\n${json.join("\n")}`)
    .split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");
}

/**
 * Code names a pipeline page writes next to drugs we track:
 *   "Enicepatide (CT-388)"        same line, in brackets (always taken)
 *   "RG6640" above "Enicepatide"  a short label line right above or below the drug name
 *   "Enicepatide · CT-388 · …"    a code on the drug's own line when no other tracked drug is on it
 */
export function extractPipelinePairs(text: string, drugs: { slug: string; name: string }[]): { slug: string; alias: string }[] {
  const lines = text.split("\n");
  const named = drugs.filter((d) => !d.name.includes(" + ") && !isUndisclosedProduct(d.slug) && !isCode(d.name)
    && /^[A-Za-z][A-Za-z -]{4,40}$/.test(d.name));
  const coded = drugs.filter((d) => isCode(d.name));
  const codeOwner = new Map(coded.map((d) => [slugify(d.name), d.slug]));
  const matchers = named.map((d) => ({ d, re: new RegExp(`(^|[^A-Za-z])${escapeRe(d.name)}(?![A-Za-z])`, "i") }));
  const namesIn = (line: string) => matchers.filter((m) => m.re.test(line)).map((m) => m.d);
  const codesIn = (line: string) =>
    [...line.toUpperCase().matchAll(CODE_TOKEN_RE)].map((m) => line.substr(m.index ?? 0, m[0].length).toUpperCase());
  const ownedByOther = (code: string, slug: string) => codeOwner.has(slugify(code)) && codeOwner.get(slugify(code)) !== slug;
  const out = new Map<string, { slug: string; alias: string }>();
  const add = (slug: string, alias: string) => {
    const k = `${slug}|${slugify(alias)}`;
    if (slugify(alias) && slugify(alias) !== slug && !out.has(k)) out.set(k, { slug, alias });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const here = namesIn(line);
    for (const d of here) {
      for (const a of titleAliases(d.name, [line])) add(d.slug, a);
      if (here.length !== 1) continue;
      if (line.length <= 200) for (const c of codesIn(line)) if (!ownedByOther(c, d.slug)) add(d.slug, c);
      for (const j of [i - 1, i + 1]) {
        const nb = lines[j];
        if (!nb || nb.length > 40 || namesIn(nb).length) continue;
        // A label below the name could belong to the next drug ("code above name" layout): skip then.
        if (j === i + 1 && lines[i + 2] && namesIn(lines[i + 2]).length) continue;
        const cs = codesIn(nb);
        if (cs.length >= 1 && cs.length <= 2) for (const c of cs) if (!ownedByOther(c, d.slug)) add(d.slug, c);
      }
    }
    // A drug tracked under its code ("HRS9531"): an INN written beside it is an alias.
    const lineCodes = new Set(codesIn(line).map(slugify));
    for (const d of coded) {
      if (!lineCodes.has(slugify(d.name))) continue;
      for (const w of line.split(/[\s,;/()·|]+/)) if (INN_STEM_RE.test(w)) add(d.slug, titleCase(w));
    }
  }
  return [...out.values()];
}

/** robots.txt allows a generic crawler to fetch this path? (Missing robots.txt = allowed.) */
async function robotsAllow(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, { signal: AbortSignal.timeout(enrichConfig.timeoutMs) });
    if (!res.ok) return true;
    let applies = false;
    for (const raw of (await res.text()).split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const k = line.slice(0, idx).trim().toLowerCase(), v = line.slice(idx + 1).trim();
      if (k === "user-agent") applies = v === "*";
      else if (applies && k === "disallow" && v && u.pathname.startsWith(v)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "obesity-trials-platform/1.0 (+https://obesity-trials.vercel.app; drug code names)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(enrichConfig.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/pdf/i.test(res.headers.get("content-type") ?? "") || /\.pdf($|\?)/i.test(url)) throw new Error("PDF — add its code names under \"known\"");
  return await res.text();
}

/**
 * Code names already confirmed on a company's pipeline page ("known" in pipeline-sources.json).
 * Each entry is attached to every drug page it names: the INN page ("Ribupatide") and/or the
 * page kept under a code ("HRS9531"); the other names become that page's aliases.
 */
export async function upsertKnownPipelineAliases(src: PipelineSources = loadPipelineSources()): Promise<number> {
  const slugs = new Set((await pool.query<{ slug: string }>("SELECT slug FROM products")).rows.map((r) => r.slug));
  const merged = new Map<string, string>();
  for (const [k, ref] of Object.entries(BUILTIN_ALIASES)) merged.set(k, ref.slug);
  for (const r of (await pool.query<{ alias_slug: string; product_slug: string }>("SELECT alias_slug, product_slug FROM product_aliases")).rows)
    merged.set(r.alias_slug, r.product_slug);
  let n = 0;
  for (const k of src.known) {
    const names = [k.drug, ...(k.aliases ?? [])].map((x) => (x ?? "").trim()).filter(Boolean);
    const targets = new Set<string>();
    for (const x of names) {
      const sl = merged.get(slugify(x)) ?? slugify(x);
      if (slugs.has(sl)) targets.add(sl);
    }
    if (!targets.size) targets.add(slugify(k.drug));
    for (const t of targets) for (const a of names) {
      if (slugify(a) === t) continue;
      await pool.query(
        `INSERT INTO pipeline_code_names (product_slug, alias, company, source_url) VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_slug, alias, company) DO UPDATE SET last_seen = now(), source_url = EXCLUDED.source_url`,
        [t, a, k.company, k.url ?? null],
      );
      n++;
    }
  }
  return n;
}

export interface PipelineReport { company: string; url: string; status: string; found: number }

/**
 * Refresh pipeline_code_names: the confirmed "known" entries every run, the pages once a
 * month (or every run with ENRICH_PIPELINES_FORCE=true).
 */
export async function refreshPipelineAliases(
  drugs: { slug: string; name: string }[], log: (m: string, o?: unknown) => void = () => {},
  opts: { force?: boolean; sources?: PipelineSources } = {},
): Promise<PipelineReport[] | null> {
  const src = opts.sources ?? loadPipelineSources();
  const upsert = (slug: string, alias: string, company: string, url: string | null) => pool.query(
    `INSERT INTO pipeline_code_names (product_slug, alias, company, source_url) VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_slug, alias, company) DO UPDATE SET last_seen = now(), source_url = EXCLUDED.source_url`,
    [slug, alias, company, url],
  );
  await upsertKnownPipelineAliases(src);

  const last = await pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'pipeline_pages_checked_at'");
  const age = last.rowCount ? Date.now() - Date.parse(last.rows[0].value) : Infinity;
  const force = opts.force ?? (process.env.ENRICH_PIPELINES_FORCE ?? "").toLowerCase() === "true";
  if (!force && age < 30 * 86_400_000) return null;

  const report: PipelineReport[] = [];
  for (const pg of src.pages) {
    const r: PipelineReport = { company: pg.company, url: pg.url, status: "ok", found: 0 };
    try {
      if (!(await robotsAllow(pg.url))) {
        r.status = "skipped (robots.txt)";
      } else {
        const text = pageText(await fetchPage(pg.url));
        const pairs = extractPipelinePairs(text, drugs);
        if (!pairs.length) r.status = text.length < 2000 ? "no text (page built with JavaScript?)" : "no code names next to tracked drugs";
        for (const p of pairs) await upsert(p.slug, p.alias, pg.company, pg.url);
        r.found = pairs.length;
      }
    } catch (e) {
      r.status = `failed (${e instanceof Error ? e.message : e})`;
    }
    report.push(r);
    await sleep(Math.max(enrichConfig.delayMs, 500));
  }
  await pool.query("DELETE FROM pipeline_code_names WHERE last_seen < now() - interval '180 days'");
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('pipeline_pages_checked_at', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [new Date().toISOString()],
  );
  log("Company pipeline pages", report);
  return report;
}

// --------------------------------------------------------------------------- #
// The job
// --------------------------------------------------------------------------- #
// --------------------------------------------------------------------------- #
// Canary check + source status (Quality page, health check)
// --------------------------------------------------------------------------- #
export type SourceName = "openFDA" | "ChEMBL" | "Inxight Drugs";
export const SOURCE_KEY: Record<SourceName, string> = { openFDA: "openfda", ChEMBL: "chembl", "Inxight Drugs": "inxight" };

/**
 * Look up a drug every source is sure to know, before using the source. A source that is down
 * fails here; one whose data format changed comes back empty — then the run leaves that
 * source's cached values alone instead of overwriting them with blanks.
 */
export async function canary(source: SourceName): Promise<{ ok: boolean; detail: string }> {
  try {
    if (source === "openFDA") {
      const r = await fdaByParts(["SEMAGLUTIDE"]);
      return r?.brands.length && r.firstApproval
        ? { ok: true, detail: `semaglutide: ${r.brands.slice(0, 3).join(", ")}` }
        : { ok: false, detail: "semaglutide came back empty (data format changed?)" };
    }
    if (source === "ChEMBL") {
      const r = await chemblByName("SEMAGLUTIDE");
      return r?.mechanisms.length
        ? { ok: true, detail: `semaglutide: ${r.id}` }
        : { ok: false, detail: "semaglutide came back empty (data format changed?)" };
    }
    const r = await inxightByName("Tirzepatide");
    return r?.targets.length
      ? { ok: true, detail: `tirzepatide: ${r.unii}` }
      : { ok: false, detail: "tirzepatide came back empty (data format changed?)" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export interface SourceState {
  ok: boolean;
  detail: string;
  checkedAt: string;
  lastOkAt: string | null;
  failingSince: string | null;  // first failed run of the current failing streak
  skipped?: boolean;            // left out with ENRICH_SKIP_SOURCES
}
export type SourceStatus = Partial<Record<SourceName, SourceState>>;

export async function loadSourceStatus(): Promise<SourceStatus> {
  const r = await pool.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'source_status'");
  try { return r.rowCount ? JSON.parse(r.rows[0].value) : {}; } catch { return {}; }
}

/** Remember how each source did this run (a failing streak keeps its start date). */
export async function recordSourceStatus(
  results: Partial<Record<SourceName, { ok: boolean; detail: string; skipped?: boolean }>>, now: Date = new Date(),
): Promise<SourceStatus> {
  const status = await loadSourceStatus();
  const at = now.toISOString();
  for (const [name, r] of Object.entries(results) as [SourceName, { ok: boolean; detail: string; skipped?: boolean }][]) {
    const prev = status[name];
    status[name] = r.skipped
      ? { ok: true, detail: "left out (ENRICH_SKIP_SOURCES)", checkedAt: at, lastOkAt: prev?.lastOkAt ?? null, failingSince: null, skipped: true }
      : r.ok
        ? { ok: true, detail: r.detail, checkedAt: at, lastOkAt: at, failingSince: null }
        : { ok: false, detail: r.detail.slice(0, 300), checkedAt: at, lastOkAt: prev?.lastOkAt ?? null, failingSince: prev?.failingSince ?? at };
  }
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('source_status', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(status)],
  );
  return status;
}

/** Names worth looking up: drug-like (an INN, a code), not a sentence or a class. */
export function lookupable(slug: string, name: string): boolean {
  if (isUndisclosedProduct(slug)) return false;
  return name.split(" + ").every((p) => p.split(/\s+/).length <= 3 && p.length <= 40 && /[A-Za-z]{3}/.test(p));
}

export interface EnrichResult {
  products: number;
  lookedUp: number;      // ChEMBL look-ups this run
  fdaChecked?: number;   // openFDA look-ups this run
  inxightChecked?: number; // Inxight Drugs look-ups this run
  inxightFound?: number;
  chemblFound: number;
  fdaFound: number;
  updated: number;
  filledFields: number;
  sourcesDown: string[];
  stoppedEarly: boolean;
  otherNames?: { trials: number; names: number } | null;
  pipelines?: PipelineReport[] | null;
  abstracts?: ImportResult | null;
  curation?: CurationResult | null;
}

export async function enrichProducts(
  opts: { log?: (m: string, o?: unknown) => void; external?: boolean; maxLookups?: number; maxInxight?: number; only?: string[] } = {},
): Promise<EnrichResult> {
  const log = opts.log ?? (() => {});
  const external = opts.external ?? enrichConfig.external;
  const started = Date.now();
  const res: EnrichResult = {
    products: 0, lookedUp: 0, fdaChecked: 0, inxightChecked: 0, inxightFound: 0, chemblFound: 0, fdaFound: 0, updated: 0, filledFields: 0, sourcesDown: [], stoppedEarly: false,
  };

  // Drug list clean-up first (non-drugs hidden, duplicates merged), then conference abstracts
  // (sync/data/conference/*.json): new drug pages for programs with no trial yet.
  if (!opts.only?.length) {
    try {
      res.curation = await applyCuration(undefined, log);
    } catch (e) {
      res.curation = null;
      log("Drug list clean-up skipped", String(e));
    }
    try {
      res.abstracts = await importAbstracts(undefined, log);
    } catch (e) {
      res.abstracts = null;
      log("Conference abstracts not imported", String(e));
    }
  }

  // Drugs with an active trial, or named by a conference abstract.
  const prods = await pool.query<{
    id: number; slug: string; name: string; auto_lookup: Lookup | null; auto_checked_at: Date | null; primary_trials: number;
  }>(
    `SELECT p.id, p.slug, p.name, p.auto_lookup, p.auto_checked_at,
            (SELECT count(*) FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
              WHERE tp.product_id = p.id AND t.obesity_class = 'primary')::int AS primary_trials
       FROM products p
      WHERE p.kind IS NULL -- not diets, procedures, tests or supplements (products.kind)
        AND (EXISTS (SELECT 1 FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active WHERE tp.product_id = p.id)
             OR EXISTS (SELECT 1 FROM product_abstracts pa WHERE pa.product_slug = p.slug))
      ${opts.only?.length ? "AND p.slug = ANY($1)" : ""}`,
    opts.only?.length ? [opts.only] : [],
  );
  res.products = prods.rowCount ?? 0;
  if (!res.products) return res;

  // Confirmed company-pipeline code names (no network needed).
  if (!opts.only?.length) {
    try { await upsertKnownPipelineAliases(); } catch { /* table not created yet */ }
  }
  // Code names registered on ClinicalTrials.gov (used for aliases and ChEMBL look-ups).
  if (external && !opts.only?.length) {
    res.otherNames = await refreshOtherNames(log);
    if (res.otherNames === null) res.sourcesDown.push("ClinicalTrials.gov other names");
    try {
      res.pipelines = await refreshPipelineAliases(prods.rows.map((p) => ({ slug: p.slug, name: p.name })), log);
    } catch (e) {
      log("Company pipeline pages skipped", String(e));
    }
  }

  // Trial facts per product (what the profile is worked out from, besides the lookups).
  const aliases: AliasMap = await loadAliases();
  const trialRows = await pool.query<{
    product_id: number; phase: string | null; sponsor: string | null; lead_sponsor_class: string | null;
    conditions: string[]; interventions: string[]; overall_status: string | null; start_date: string | null;
    nct_id: string; title: string | null;
  }>(
    `SELECT tp.product_id, t.nct_id, t.phase, t.sponsor, t.lead_sponsor_class, t.conditions, t.interventions,
            t.overall_status, t.start_date, r.payload #>> '{protocolSection,identificationModule,briefTitle}' AS title
       FROM trial_products tp JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
       LEFT JOIN raw_trials r ON r.source = 'CTGOV' AND r.source_id = t.nct_id
      WHERE tp.product_id = ANY($1)`,
    [prods.rows.map((p) => p.id)],
  );
  // ClinicalTrials.gov "other names" per trial intervention (table from migration 0018).
  const otherByTrial = new Map<string, Map<string, string[]>>();
  try {
    const on = await pool.query<{ nct_id: string; intervention: string; other_name: string }>(
      "SELECT nct_id, intervention, other_name FROM intervention_other_names WHERE nct_id = ANY($1)",
      [[...new Set(trialRows.rows.map((r) => r.nct_id))]],
    );
    for (const o of on.rows) {
      const m = otherByTrial.get(o.nct_id) ?? new Map<string, string[]>();
      m.set(o.intervention, [...(m.get(o.intervention) ?? []), o.other_name]);
      otherByTrial.set(o.nct_id, m);
    }
  } catch { /* table not created yet */ }
  const pipelineBySlug = new Map<string, PipelineAlias[]>();
  try {
    const pl = await pool.query<{ product_slug: string; alias: string; company: string }>(
      "SELECT product_slug, alias, company FROM pipeline_code_names ORDER BY first_seen",
    );
    for (const r of pl.rows) pipelineBySlug.set(r.product_slug, [...(pipelineBySlug.get(r.product_slug) ?? []), { alias: r.alias, company: r.company }]);
  } catch { /* table not created yet */ }
  const abstractsBySlug = new Map<string, AbstractFact[]>();
  try {
    const ab = await pool.query<{
      product_slug: string; aliases: string[]; source: string; sponsor: string | null; indication: string | null;
      stage: string | null; mechanism: string | null; program: string | null; drugs: number; drug_name: string;
    }>(
      `SELECT pa.product_slug, pa.aliases, pa.drug_name, a.source, a.sponsor, a.indication, a.stage, a.mechanism, a.program,
              (SELECT count(*) FROM product_abstracts o WHERE o.source = a.source AND o.abstract_no = a.abstract_no)::int AS drugs
         FROM product_abstracts pa JOIN conference_abstracts a USING (source, abstract_no)
        ORDER BY a.source, a.abstract_no`,
    );
    for (const r of ab.rows) {
      abstractsBySlug.set(r.product_slug, [...(abstractsBySlug.get(r.product_slug) ?? []), {
        source: r.source, sponsor: r.sponsor, indication: r.indication, stage: r.stage, mechanism: r.mechanism,
        program: r.program, aliases: r.aliases ?? [],
        // About this drug alone: the only drug linked, and the program names no other drug
        // ("Vanoglipel + resmetirom" is not about vanoglipel alone, even if resmetirom isn't tracked).
        solo: r.drugs === 1 && (r.drug_name.includes(" + ") || !/\s\+\s|\svs\.?\s|;/i.test(r.program ?? "")),
      }]);
    }
  } catch { /* table not created yet */ }
  const allNames = await pool.query<{ interventions: string[] }>("SELECT interventions FROM trials WHERE is_active");
  const known = buildKnownSet(allNames.rows.map((r) => r.interventions ?? []), aliases);
  const aliasRows = await pool.query<{ alias_slug: string; product_slug: string }>("SELECT alias_slug, product_slug FROM product_aliases");

  const bySlugAliases = new Map<string, string[]>();
  for (const [k, ref] of Object.entries(BUILTIN_ALIASES)) bySlugAliases.set(ref.slug, [...(bySlugAliases.get(ref.slug) ?? []), k]);
  for (const a of aliasRows.rows) bySlugAliases.set(a.product_slug, [...(bySlugAliases.get(a.product_slug) ?? []), a.alias_slug]);

  const facts = new Map<number, TrialFact[]>();
  const slugOf = new Map(prods.rows.map((p) => [p.id, p.slug]));
  const nameCache = new Map<string, string[]>();
  for (const r of trialRows.rows) {
    const slug = slugOf.get(r.product_id)!;
    const slugsOf = (n: string) => {
      let slugs = nameCache.get(n);
      if (!slugs) { slugs = productsFromName(n, aliases, known).map((x) => x.slug); nameCache.set(n, slugs); }
      return slugs;
    };
    const names = (r.interventions ?? []).filter((n) => slugsOf(n).includes(slug));
    const soleNames = names.filter((n) => slugsOf(n).length === 1);
    const list = facts.get(r.product_id) ?? [];
    list.push({
      phase: r.phase, sponsor: r.sponsor, sponsorClass: r.lead_sponsor_class, conditions: r.conditions ?? [],
      names, soleNames, status: r.overall_status, start: r.start_date, title: r.title,
      otherNames: soleNames.flatMap((n) => otherByTrial.get(r.nct_id)?.get(n) ?? []),
    });
    facts.set(r.product_id, list);
  }

  // Work out every product's automatic profile from trials + cached lookups and save
  // what changed. Runs first (trial-based values show right away), every 25 lookups
  // (the site fills in while the run goes on) and at the end.
  const altNames = new Map<number, string[]>(); // code names to try in ChEMBL when the name isn't found
  const writeAll = async () => {
    const ids: number[] = [], infos: string[] = [];
    let filled = 0;
    for (const p of prods.rows) {
      const auto = deriveAuto({
        slug: p.slug, name: p.name, trials: facts.get(p.id) ?? [],
        aliasKeys: bySlugAliases.get(p.slug) ?? [], lookup: p.auto_lookup, pipelineAliases: pipelineBySlug.get(p.slug),
        abstracts: abstractsBySlug.get(p.slug),
      });
      filled += Object.keys(auto).length;
      if (auto.aliases) altNames.set(p.id, auto.aliases.value.split(", ").filter((a) => a && !/\s/.test(a)).slice(0, 3));
      ids.push(p.id);
      infos.push(JSON.stringify(auto));
    }
    const upd = await pool.query(
      `UPDATE products p SET auto_info = v.info, auto_updated_at = now()
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::jsonb[]) AS info) v
        WHERE p.id = v.id AND p.auto_info IS DISTINCT FROM v.info`,
      [ids, infos],
    );
    res.updated += upd.rowCount ?? 0;
    res.filledFields = filled;
  };

  await writeAll();

  // External lookups, most-studied drugs first. Two passes:
  //  1) openFDA for every drug that is due (fast; with an OPENFDA_API_KEY there is no
  //     practical daily limit, without one openFDA allows 1,000 requests a day);
  //  2) ChEMBL, slower, a limited number per run (ENRICH_MAX_LOOKUPS) within the time budget;
  //  3) NCATS Inxight Drugs, ENRICH_MAX_INXIGHT per run, unhurried (a public NIH service that
  //     asks not to be bulk-downloaded: two requests per drug, ~0.6 s apart, once a month).
  if (external) {
    const maxAge = enrichConfig.refreshDays * 86_400_000;
    const stale = (t?: string | null) => !t || Date.now() - Date.parse(t) > maxAge;
    const current = (p: (typeof prods.rows)[number]) => (p.auto_lookup?.v === LOOKUP_VERSION ? p.auto_lookup : null);
    const candidates = prods.rows
      .filter((p) => lookupable(p.slug, p.name))
      .sort((a, b) => b.primary_trials - a.primary_trials || a.name.localeCompare(b.name));
    const save = async (p: (typeof prods.rows)[number], next: Lookup) => {
      p.auto_lookup = next;
      const fresh = !stale(next.fdaAt) && !stale(next.chemblAt) && !stale(next.inxightAt);
      await pool.query(
        `UPDATE products SET auto_lookup = $2, auto_checked_at = CASE WHEN $3 THEN now() ELSE auto_checked_at END WHERE id = $1`,
        [p.id, JSON.stringify(next), fresh],
      );
    };
    const blank = (): Lookup => ({ v: LOOKUP_VERSION, chembl: [], fda: null, at: new Date().toISOString() });
    // A look-up saved before each source kept its own date has only `at` (it covered openFDA and ChEMBL).
    const legacy = (c: Lookup) => !c.fdaAt && !c.chemblAt && !c.inxightAt;
    const due = (c: Lookup | null, t: string | undefined) => !c || (t ? stale(t) : legacy(c) ? stale(c.at) : true);
    // One drug's failed look-up (e.g. a query a service answers with an error) skips that
    // drug only — it is retried next run. Three failures in a row = the service is down.
    const tracker = (label: string) => {
      let streak = 0, failed = 0, last = "";
      return {
        ok() { streak = 0; },
        down: () => streak >= 3,
        lastError: () => last,
        /** true = stop this source for the rest of the run */
        fail(e: unknown, drug: string): boolean {
          failed++; streak++; last = e instanceof Error ? e.message : String(e);
          if (streak >= 3) { log(`${label} unavailable — skipping it for the rest of this run`, last); return true; }
          log(`${label}: ${drug} skipped this run (will retry)`, last);
          return false;
        },
        done() {
          if (streak >= 3) res.sourcesDown.push(`${label}: ${last}`);
          else if (failed) res.sourcesDown.push(`${label}: ${failed} drug(s) skipped, e.g. ${last}`);
        },
      };
    };

    // Each source: skipped on request, then a canary look-up of a well-known drug before its pass.
    const results: Partial<Record<SourceName, { ok: boolean; detail: string; skipped?: boolean }>> = {};
    const ready = async (name: SourceName, dueCount: number): Promise<boolean> => {
      if (enrichConfig.skipSources.has(SOURCE_KEY[name])) { results[name] = { ok: true, detail: "", skipped: true }; return false; }
      if (!dueCount) return false; // nothing to do: no requests at all
      const c = await canary(name);
      results[name] = c;
      if (!c.ok) {
        res.sourcesDown.push(`${name}: check look-up failed — ${c.detail}`);
        log(`${name}: check look-up failed — leaving its saved values as they are this run`, c.detail);
      }
      return c.ok;
    };
    const finish = (name: SourceName, t: { down: () => boolean; lastError: () => string }) => {
      if (results[name]?.ok && t.down()) results[name] = { ok: false, detail: t.lastError() };
    };

    // 1) openFDA
    const fdaDue = candidates.filter((p) => { const c = current(p); return due(c, c?.fdaAt); })
      .slice(0, enrichConfig.fdaKey ? 100_000 : 900);
    let done = 0;
    const fdaT = tracker("openFDA");
    log(`openFDA: ${fdaDue.length} drugs due`);
    if (await ready("openFDA", fdaDue.length)) for (const p of fdaDue) {
      if (Date.now() - started > enrichConfig.budgetMs) { res.stoppedEarly = true; break; }
      const parts = p.name.split(" + ").map((x) => x.trim());
      const cur = current(p);
      const next: Lookup = { ...(cur ?? blank()) };
      try {
        next.fda = await fdaByParts(parts);
      } catch (e) {
        if (fdaT.fail(e, p.name)) break;
        continue;
      }
      fdaT.ok();
      next.fdaAt = new Date().toISOString();
      if (cur && legacy(cur)) next.chemblAt = cur.at; // keep the old ChEMBL date
      await save(p, next);
      done++;
      if (next.fda) res.fdaFound++;
      if (done % 100 === 0) { await writeAll(); log(`openFDA: ${done}/${fdaDue.length} drugs checked`); }
    }
    fdaT.done();
    finish("openFDA", fdaT);
    res.fdaChecked = done;
    if (done) await writeAll();

    // 2) ChEMBL
    const chemblDue = candidates.filter((p) => { const c = current(p); return due(c, c?.chemblAt); })
      .slice(0, opts.maxLookups ?? enrichConfig.maxLookups);
    const chemblT = tracker("ChEMBL");
    log(`ChEMBL: ${chemblDue.length} drugs this run (up to ${opts.maxLookups ?? enrichConfig.maxLookups})`);
    if (await ready("ChEMBL", chemblDue.length)) for (const p of chemblDue) {
      if (Date.now() - started > enrichConfig.budgetMs) { res.stoppedEarly = true; break; }
      const parts = p.name.split(" + ").map((x) => x.trim());
      const next: Lookup = { ...(current(p) ?? blank()) };
      try {
        const found: (ChemblInfo | null)[] = [];
        for (const part of parts) {
          let hit = await chemblByName(part);
          // A new INN may not be in ChEMBL yet: try the drug's code names (e.g. CT-388).
          if (!hit && parts.length === 1) for (const alt of altNames.get(p.id) ?? []) { hit = await chemblByName(alt); if (hit) break; }
          found.push(hit);
        }
        next.chembl = found;
      } catch (e) {
        if (chemblT.fail(e, p.name)) break;
        continue;
      }
      chemblT.ok();
      next.chemblAt = new Date().toISOString();
      await save(p, next);
      res.lookedUp++;
      if (next.chembl.some(Boolean)) res.chemblFound++;
      if (res.lookedUp % 25 === 0) { await writeAll(); log(`ChEMBL: ${res.lookedUp}/${chemblDue.length} drugs checked`); }
    }
    chemblT.done();
    finish("ChEMBL", chemblT);
    if (res.lookedUp) await writeAll();

    // 3) Inxight Drugs
    const inxightDue = candidates.filter((p) => { const c = current(p); return !c || !c.inxightAt || stale(c.inxightAt); })
      .slice(0, opts.maxInxight ?? enrichConfig.maxInxight);
    let checked = 0;
    const inxT = tracker("Inxight Drugs");
    log(`Inxight Drugs: ${inxightDue.length} drugs this run (up to ${opts.maxInxight ?? enrichConfig.maxInxight})`);
    if (await ready("Inxight Drugs", inxightDue.length)) for (const p of inxightDue) {
      if (Date.now() - started > enrichConfig.budgetMs) { res.stoppedEarly = true; break; }
      const parts = p.name.split(" + ").map((x) => x.trim());
      const next: Lookup = { ...(current(p) ?? blank()) };
      try {
        const found: (InxightInfo | null)[] = [];
        for (const part of parts) {
          let hit = await inxightByName(part);
          if (!hit && parts.length === 1) for (const alt of altNames.get(p.id) ?? []) { hit = await inxightByName(alt); if (hit) break; }
          found.push(hit);
        }
        next.inxight = found;
      } catch (e) {
        if (inxT.fail(e, p.name)) break;
        continue;
      }
      inxT.ok();
      next.inxightAt = new Date().toISOString();
      await save(p, next);
      checked++;
      if (next.inxight!.some(Boolean)) res.inxightFound = (res.inxightFound ?? 0) + 1;
      if (checked % 25 === 0) { await writeAll(); log(`Inxight Drugs: ${checked}/${inxightDue.length} drugs checked`); }
    }
    inxT.done();
    finish("Inxight Drugs", inxT);
    res.inxightChecked = checked;
    if (Object.keys(results).length && !opts.only?.length) {
      try { await recordSourceStatus(results); } catch (e) { log("Source status not saved", String(e)); }
    }
  }

  if (res.lookedUp || res.fdaChecked || res.inxightChecked) await writeAll();
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('product_autofill_at', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [new Date().toISOString()],
  );
  // A short record of the last full run, for the Quality page.
  if (!opts.only?.length) {
    const last = {
      at: new Date().toISOString(), external, minutes: Math.round((Date.now() - started) / 6000) / 10,
      products: res.products, updated: res.updated, filledFields: res.filledFields,
      openFDA: { checked: res.fdaChecked ?? 0, found: res.fdaFound },
      ChEMBL: { checked: res.lookedUp, found: res.chemblFound },
      "Inxight Drugs": { checked: res.inxightChecked ?? 0, found: res.inxightFound ?? 0 },
      sourcesDown: res.sourcesDown, stoppedEarly: res.stoppedEarly,
      merged: res.curation?.merged ?? 0, hiddenByRule: res.curation?.byRule.length ?? 0,
      abstracts: res.abstracts?.abstracts ?? 0, newFromAbstracts: res.abstracts?.created.length ?? 0,
    };
    await pool.query(
      `INSERT INTO app_meta (key, value) VALUES ('product_autofill_last', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(last)],
    );
  }
  return res;
}
