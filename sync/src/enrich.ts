// Automatic drug profiles ("auto-fill").
//
// Fills the blank drug-profile fields of every product with values worked out from
//   - our own trial data (company, indication, highest phase, pipeline status,
//     combination parts, code names and route words in the intervention names)
//   - ChEMBL (EMBL-EBI, free, CC BY-SA): modality, mechanism of action,
//     research codes, trade names, max phase, withdrawn flag
//   - openFDA drugsfda (US FDA, public domain): US brand names, route,
//     first US approval date, FDA pharmacologic class
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

export interface Lookup {
  v: number;
  chembl: (ChemblInfo | null)[]; // one per component (a combination has several)
  fda: FdaInfo | null;
  at: string;
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
  const glp1 = /glucagon-like peptide[- ]1|glp-?1/.test(t);
  const gip = /gastric inhibitory polypeptide|glucose-dependent insulinotropic|\bgipr?\b/.test(t);
  const gipAntagonist = /(gastric inhibitory polypeptide|\bgipr?\b)[^;]*(antagonist|inhibitor|blocker)/.test(t);
  const gcg = /(^|[^-])\bglucagon receptor\b|\bgcgr?\b|glucagon agonist/.test(t);
  const amylin = /amylin|calcitonin receptor/.test(t);
  if (glp1 && gip && gcg) return "GIP/GLP-1/glucagon triple agonist";
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

export interface DeriveInput {
  slug: string;
  name: string;
  trials: TrialFact[];
  aliasKeys: string[];           // alias slugs that fold into this product (built-in + product_aliases)
  pipelineAliases?: PipelineAlias[]; // code names from company pipeline pages
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
  const now = input.now ?? new Date();

  // Approval -------------------------------------------------------------------
  const phase4Trial = trials.some((t) => phaseLevel(t.phase) === 4);
  let approved: AutoValue | null = null;
  if (fda) approved = { value: "Yes", source: "openFDA" };
  else if (!combo && single && single.maxPhase !== null && single.maxPhase >= 4) approved = { value: "Yes", source: "ChEMBL" };
  else if (combo && chembl.length === parts.length && chembl.every((c) => (c.maxPhase ?? 0) >= 4) && phase4Trial)
    approved = { value: "Yes", source: "ChEMBL + trials" };
  else if (!combo && single) approved = { value: "No", source: "ChEMBL" };
  else if (!undisclosed && phase4Trial) approved = { value: "Yes", source: "Trials (Phase 4)" };
  if (approved) set("approved", approved.value, approved.source);
  const isApproved = approved?.value === "Yes";
  const withdrawn = !!single?.withdrawn;

  if (fda?.firstApproval) set("approval_date", fda.firstApproval, "openFDA (first US approval)");
  else if (isApproved && single?.firstApproval) set("approval_date", String(single.firstApproval), "ChEMBL (first approval year)");

  // Phase ------------------------------------------------------------------------
  const tp = phaseLabelFromTrials(trials);
  if (withdrawn) set("phase", "Withdrawn", "ChEMBL");
  else if (isApproved) set("phase", "Approved", approved!.source);
  else {
    const cp = single?.maxPhase ?? null;
    if (cp !== null && cp >= 1 && (!tp || Math.floor(cp) > tp.level)) set("phase", `Phase ${Math.floor(cp)}`, "ChEMBL");
    else if (tp && tp.level < 4) set("phase", tp.label, "Trials");
  }

  // Company -------------------------------------------------------------------
  if (fda && fda.generics >= 3 && !trials.some((t) => (t.sponsorClass ?? "").toUpperCase() === "INDUSTRY")) {
    set("sponsor", "Generic (several companies)", "openFDA");
  } else {
    const s = topSponsor(trials, fda?.sponsors ?? []);
    if (s) set("sponsor", s, trials.some((t) => t.sponsor === s) ? "Trials" : "openFDA");
  }

  // Pipeline / non-pipeline ----------------------------------------------------
  // Pipeline = a drug a company is developing (industry); Non-pipeline = an academic
  // drug (only universities / hospitals / public funders run its trials, or a generic
  // with no single developing company). Decided by who sponsors the drug's trials.
  const industryTrials = trials.filter((t) => (t.sponsorClass ?? "").toUpperCase() === "INDUSTRY").length;
  const company = out.sponsor && out.sponsor.value !== "Generic (several companies)" ? out.sponsor.value : null;
  if (company) set("candidate", "Pipeline", `Industry (${company})`);
  else if (trials.length) {
    set("candidate", "Non-pipeline",
      out.sponsor ? "Generic, no developing company"
        : industryTrials ? "Academic (no single developing company)" : "Academic (no industry-sponsored trials)");
  }

  // Indication -----------------------------------------------------------------
  set("indication", topIndications(trials), "Trials");

  // Combination parts ----------------------------------------------------------
  if (combo) set("parent_drug", parts.join(", "), "Drug name");

  // Code names (aliases) --------------------------------------------------------
  // Sources in order of trust; the first spelling seen wins ("CT-388" over "CT388").
  const codes: { v: string; src: string }[] = [];
  const ownSlug = slugify(input.name);
  // 0) The developer's own pipeline page, then ChEMBL.
  for (const pa of input.pipelineAliases ?? []) codes.push({ v: pa.alias, src: `Company pipeline (${pa.company})` });
  for (const c of chembl) for (const x of c.codes) codes.push({ v: x, src: "ChEMBL" });
  // 1) ClinicalTrials.gov "other names" registered for this drug's interventions.
  for (const t of trials) for (const o of t.otherNames ?? []) {
    for (const a of aliasCandidates(o)) codes.push({ v: a, src: "ClinicalTrials.gov" });
  }
  // 2) Trial titles: "Enicepatide (CT-388)" or "CT-388 (Enicepatide)".
  for (const a of titleAliases(input.name, trials.map((t) => t.title ?? ""))) codes.push({ v: a, src: "Trial titles" });
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
  if (codeList.length) set("aliases", codeList.map((c) => c.v).join(", "), [...new Set(codeList.map((c) => c.src))].join(" + "));

  // Brand names ----------------------------------------------------------------
  const brands: { v: string; src: string }[] = [];
  for (const b of fda?.brands ?? []) brands.push({ v: titleCase(b), src: "openFDA" });
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
  if (mechs.length) set("moa", mechs.join("; "), "ChEMBL");
  else if (fdaMoa.length) set("moa", fdaMoa.join("; "), "openFDA");

  // Therapy subclass / class -----------------------------------------------------
  const isSmall = !combo && (single?.type ?? "").toLowerCase() === "small molecule";
  const fdaEpc = (fda?.epc ?? []).map((e) => e.replace(/\s*\[EPC\]\s*$/i, "")).join("; ");
  let sub: AutoValue | null = null;
  const fromMech = subclassFrom(mechs.join("; "), isSmall);
  if (combo) {
    // A combination: the parts' classes ("GLP-1 receptor agonist + Amylin analogue").
    const perPart = chembl.map((c) => subclassFrom(c.mechanisms.map((m) => m.moa).join("; "), (c.type ?? "").toLowerCase() === "small molecule"));
    const joined = uniqText(perPart.filter((x): x is string => !!x));
    if (joined.length) sub = { value: joined.join(" + "), source: "ChEMBL" };
  } else if (fromMech) sub = { value: fromMech, source: "ChEMBL" };
  if (!sub && fdaEpc) {
    const s = subclassFrom(fdaEpc, isSmall);
    sub = { value: s ?? fdaEpc.split("; ")[0], source: "openFDA" };
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
  if (combo) set("modality", "Combination", "Drug name");
  else if (single?.type) {
    const t = single.type.toLowerCase();
    const peptideLike = /tide$/i.test(input.name) || /GLP-1|GIP|glucagon|amylin|MC4R/.test(sub?.value ?? "");
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

export async function fdaByParts(parts: string[]): Promise<FdaInfo | null> {
  const q = parts
    .map((p) => encodeURIComponent(`products.active_ingredients.name:"${p.toUpperCase().replace(/"/g, "")}"`))
    .join("+AND+");
  const key = enrichConfig.fdaKey ? `&api_key=${encodeURIComponent(enrichConfig.fdaKey)}` : "";
  const r = await getJson(`${enrichConfig.fdaBase}/drug/drugsfda.json?search=${q}&limit=1000${key}`);
  await sleep(enrichConfig.delayMs);
  return parseFda(Array.isArray(r?.results) ? r.results : [], parts);
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
  return await res.text();
}

/** Code names already confirmed on a company's pipeline page ("known" in pipeline-sources.json). */
export async function upsertKnownPipelineAliases(src: PipelineSources = loadPipelineSources()): Promise<number> {
  let n = 0;
  for (const k of src.known) for (const a of k.aliases ?? []) {
    if (!a?.trim()) continue;
    await pool.query(
      `INSERT INTO pipeline_code_names (product_slug, alias, company, source_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_slug, alias, company) DO UPDATE SET last_seen = now(), source_url = EXCLUDED.source_url`,
      [slugify(k.drug), a.trim(), k.company, k.url ?? null],
    );
    n++;
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
/** Names worth looking up: drug-like (an INN, a code), not a sentence or a class. */
export function lookupable(slug: string, name: string): boolean {
  if (isUndisclosedProduct(slug)) return false;
  return name.split(" + ").every((p) => p.split(/\s+/).length <= 3 && p.length <= 40 && /[A-Za-z]{3}/.test(p));
}

export interface EnrichResult {
  products: number;
  lookedUp: number;
  chemblFound: number;
  fdaFound: number;
  updated: number;
  filledFields: number;
  sourcesDown: string[];
  stoppedEarly: boolean;
  otherNames?: { trials: number; names: number } | null;
  pipelines?: PipelineReport[] | null;
}

export async function enrichProducts(
  opts: { log?: (m: string, o?: unknown) => void; external?: boolean; maxLookups?: number; only?: string[] } = {},
): Promise<EnrichResult> {
  const log = opts.log ?? (() => {});
  const external = opts.external ?? enrichConfig.external;
  const started = Date.now();
  const res: EnrichResult = {
    products: 0, lookedUp: 0, chemblFound: 0, fdaFound: 0, updated: 0, filledFields: 0, sourcesDown: [], stoppedEarly: false,
  };

  const prods = await pool.query<{
    id: number; slug: string; name: string; auto_lookup: Lookup | null; auto_checked_at: Date | null; primary_trials: number;
  }>(
    `SELECT p.id, p.slug, p.name, p.auto_lookup, p.auto_checked_at,
            count(*) FILTER (WHERE t.obesity_class = 'primary')::int AS primary_trials
       FROM products p
       JOIN trial_products tp ON tp.product_id = p.id
       JOIN trials t ON t.nct_id = tp.nct_id AND t.is_active
      ${opts.only?.length ? "WHERE p.slug = ANY($1)" : ""}
      GROUP BY p.id`,
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

  // External lookups for the products that are due, most-studied first. ----
  if (external) {
    const maxAge = enrichConfig.refreshDays * 86_400_000;
    const due = prods.rows
      .filter((p) => lookupable(p.slug, p.name))
      .filter((p) => !p.auto_lookup || p.auto_lookup.v !== LOOKUP_VERSION || !p.auto_checked_at
        || Date.now() - new Date(p.auto_checked_at).getTime() > maxAge)
      .sort((a, b) => Number(!!a.auto_checked_at) - Number(!!b.auto_checked_at) || b.primary_trials - a.primary_trials)
      .slice(0, opts.maxLookups ?? enrichConfig.maxLookups);
    let chemblUp = true, fdaUp = true;
    for (const p of due) {
      if (Date.now() - started > enrichConfig.budgetMs) { res.stoppedEarly = true; break; }
      if (!chemblUp && !fdaUp) break;
      const parts = p.name.split(" + ").map((s) => s.trim());
      const prev = p.auto_lookup?.v === LOOKUP_VERSION ? p.auto_lookup : null;
      const next: Lookup = { v: LOOKUP_VERSION, chembl: prev?.chembl ?? [], fda: prev?.fda ?? null, at: new Date().toISOString() };
      let complete = true;
      if (chemblUp) {
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
          chemblUp = false; complete = false;
          res.sourcesDown.push(`ChEMBL: ${e instanceof Error ? e.message : e}`);
          log("ChEMBL unavailable — skipping it for the rest of this run", String(e));
        }
      } else complete = false;
      if (fdaUp) {
        try {
          next.fda = await fdaByParts(parts);
        } catch (e) {
          fdaUp = false; complete = false;
          res.sourcesDown.push(`openFDA: ${e instanceof Error ? e.message : e}`);
          log("openFDA unavailable — skipping it for the rest of this run", String(e));
        }
      } else complete = false;
      res.lookedUp++;
      if (next.chembl.some(Boolean)) res.chemblFound++;
      if (next.fda) res.fdaFound++;
      p.auto_lookup = next;
      // Only a complete lookup counts as "checked"; a partial one is retried next run.
      await pool.query(
        `UPDATE products SET auto_lookup = $2, auto_checked_at = CASE WHEN $3 THEN now() ELSE auto_checked_at END WHERE id = $1`,
        [p.id, JSON.stringify(next), complete],
      );
      if (res.lookedUp % 25 === 0) {
        await writeAll();
        log(`looked up ${res.lookedUp}/${due.length}`);
      }
    }
  }

  if (res.lookedUp) await writeAll();
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('product_autofill_at', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [new Date().toISOString()],
  );
  return res;
}
