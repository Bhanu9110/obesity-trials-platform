// Obesity classification of a trial, judged from its condition list (in registry
// order), its brief title and — for industry trials — its drug names.
//
//   primary        obesity is the LEAD condition (see classifyObesity below)
//   comorbidity    obesity is listed, but another disease is the real indication
//                  (Alzheimer's, heart failure, PCOS, pregnancy, type 2 diabetes…)
//   weight_related no obesity condition, but weight-management terms (weight loss, BMI…)
//   unrelated      none of the above (CT.gov's search matched other fields)
//
// Only `primary` trials are stored (see STORE_SCOPE in sync.ts). Bump
// CLASSIFIER_VERSION when the rules change — stored trials are then re-classified
// automatically and trials that are no longer primary are removed.
//
// In-scope indications: obesity, obese, overweight, morbid obesity, hyperlipidemia,
// dyslipidemia, genetic / syndromic obesity (Bardet-Biedl, POMC, hypothalamic…).

export const CLASSIFIER_VERSION = "obesity-2.2";
// 2.2: the LEAD condition decides. A trial is primary only when obesity is the first
//      listed condition (healthy-volunteer / PK items skipped); when another disease
//      is listed first (Alzheimer's, heart failure, PCOS, type 2 diabetes…) obesity is
//      a comorbidity unless the title names obesity as the treated condition first.
//      Industry trials no longer count as primary just because obesity appears
//      somewhere; lipodystrophy / contraception / weight-gain contexts excluded.
// 2.1: negations ("non-diabetic") ignored; several conditions typed into one field
//      ("Type 2 Diabetes; Obesity") split; industry-sponsored trials that name obesity
//      or weight loss / weight management — in the conditions OR the title — are counted
//      as primary (competitor trials).

export type ObesityClass = "primary" | "comorbidity" | "weight_related" | "unrelated";

export interface ObesityClassification {
  class: ObesityClass;
  reason: string;
  /** the condition items that decided the class */
  terms: string[];
}

export const OBESITY_INDICATION_ROOTS = ["obes", "overweight", "hyperlipid", "dyslipid"];

// Weight-management wording without an in-scope indication term.
const WEIGHT_TERMS = [
  "weight loss", "weight reduction", "weight management", "weight maintenance", "weight control",
  "weight gain", "body weight", "bodyweight", "adiposity", "body fat", "fat mass", "visceral fat",
  "bmi", "body mass index", "waist circumference", "energy intake", "appetite",
];

// If a condition item names one of THESE other diseases, obesity there is usually
// a comorbidity / subject context rather than the indication.
const OTHER_DISEASE_TERMS = [
  "diabet", "prediabet", "nash", "nafld", "mash", "masld", "steatohepat", "steatosis", "fatty liver",
  "hypertens", "blood pressure", "cardiovascular", "coronary", "heart failure",
  "myocardial", "angina", "arrhythmia", "atrial fib", "stroke", "atheroscler",
  "cancer", "carcinoma", "tumour", "tumor", "neoplas", "oncolog", "leukemia", "leukaemia",
  "lymphoma", "melanoma",
  "arthritis", "osteoarthr", "rheumatoid", "osteoporos", "gout",
  "depress", "schizophren", "bipolar", "anxiety", "psychiat", "psychosis",
  "infertil", "fertilit", "pregnan", "gestational", "menopaus", "polycystic", "pcos",
  "asthma", "copd", "respiratory", "apnoea", "apnea", "sleep",
  "psoriasis", "dermatit", "eczema",
  "kidney", "renal", "nephro", "ckd", "cirrhosis", "hepatitis",
  "migraine", "epilep", "seizure", "alzheimer", "dementia", "parkinson", "multiple sclerosis",
  "hiv", "transplant", "covid", "influenza", "thyroid", "anaemia", "anemia",
  "hypogonad", "testosterone", "incontinence", "hidradenitis", "alcohol", "substance", "smoking", "nicotine",
  "bowel", "crohn", "colitis", "thrombo", "embol", "neuromuscular", "anesthe", "anaesthe", "analges",
  "pain", "nausea", "vomiting", "fibrosis", "endometri", "uterine", "ovarian", "optic", "neuropath",
  "lupus", "sickle", "cystic fibrosis", "growth hormone", "acromegal", "cushing", "contracept",
];

function foldText(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Terms match at the START of a word ("renal" matches "renal impairment" but not "adrenal").
const termRegex = (terms: string[]) => new RegExp(`\\b(?:${terms.map(escape).join("|")})`, "g");
const OBESITY_RE = termRegex(OBESITY_INDICATION_ROOTS);
const OTHER_RE = termRegex(OTHER_DISEASE_TERMS);
// A disease that is NEGATED is not a competing indication: "non-diabetic overweight",
// "obesity without diabetes", "free of hypertension".
const NEGATED_OTHER_RE = new RegExp(
  `\\b(?:non|not|without|no|free of|absence of|excluding|except)[\\s-]*(?:${OTHER_DISEASE_TERMS.map(escape).join("|")})\\w*`,
  "g",
);
// Obesity in a trial TITLE (industry rule only).
const TITLE_OBESITY_RE = /\b(?:obes\w*|overweight|anti-?obesity|weight (?:loss|reduction|management|maintenance|control))\b/;
// Weight loss from wasting diseases is not obesity.
const WASTING_RE = /\b(?:cachexi\w*|anorexi\w*|wasting|sarcopeni\w*|malnutrition)\b/;
// Weight-loss / weight-management wording (not "weight gain"): an obesity indication
// in all but name. Counted as primary for industry-sponsored trials.
const WEIGHT_LOSS_RE = termRegex([
  "weight loss", "weight reduction", "weight management", "weight maintenance", "weight control",
  "body weight", "bodyweight", "adiposity", "body fat", "fat mass", "visceral fat", "bmi", "body mass index",
]);
const WEIGHT_RE = termRegex(WEIGHT_TERMS);

function firstMatch(re: RegExp, t: string): { index: number; term: string } | null {
  re.lastIndex = 0;
  const m = re.exec(t);
  return m ? { index: m.index, term: m[0] } : null;
}

type ItemVerdict = { kind: "primary" | "comorbidity" | "weight" | "none"; other?: string };

/** Classify ONE condition item. */
export function classifyConditionItem(item: string): ItemVerdict {
  const t = foldText(item)
    .replace(NEGATED_OTHER_RE, " ")
    // "Participants With Obesity and Knee Osteoarthritis" -> "obesity and knee osteoarthritis"
    .replace(/^\s*(?:(?:adult|adolescent|paediatric|pediatric|male|female)\s+)?(?:participants?|patients?|subjects?|adults?|people|persons?|individuals?|women|men|children)\s+(?:living\s+)?with\s+/, "");
  const obes = firstMatch(OBESITY_RE, t);
  if (!obes) return { kind: firstMatch(WEIGHT_RE, t) ? "weight" : "none" };
  const other = firstMatch(OTHER_RE, t);
  if (!other) return { kind: "primary" };                      // pure in-scope condition

  // Another disease is named too — is obesity the indication or the context?
  // obesity as a modifier of another disease ("obesity-associated hypertension") -> context
  if (/obes\w*[ -](associated|related|induced|linked|driven|due to|mediated)/.test(t)) {
    return { kind: "comorbidity", other: other.term };
  }
  // other diseases framed as comorbidities of the obese population -> obesity is primary
  if (/comorbid|co-morbid|coexist|co-exist|concomitant|risk factor|complication/.test(t)) {
    return { kind: "primary" };
  }
  // otherwise obesity is primary only if it clearly LEADS the description
  return obes.index < other.index && obes.index <= 15
    ? { kind: "primary" }
    : { kind: "comorbidity", other: other.term };
}

/** True when a single condition item is PRIMARILY an in-scope obesity indication. */
export function isObesityConditionItem(item: string): boolean {
  return classifyConditionItem(item).kind === "primary";
}

/** Registries sometimes put several conditions in one field: "Type 2 Diabetes ;Obesity". */
export function splitConditions(conditions: string[]): string[] {
  return (conditions || [])
    .flatMap((c) => String(c ?? "").split(/[;；|\n]+/))
    .map((c) => c.trim())
    .filter(Boolean);
}

// Items that say nothing about the indication: healthy-volunteer, PK and
// special-population studies. They are skipped when finding the lead condition.
const GENERIC_RE = new RegExp(
  "\\b(?:healthy|health (?:adults?|subjects?|volunteers?|participants?)|volunteers?|normal subjects?|" +
    "pharmacokinetic\\w*|pharmacodynamic\\w*|bioavailab\\w*|bioequival\\w*|drug[- ]drug|drug interactions?|food effects?|" +
    "safety|tolerability|(?:renal|hepatic) impairment|japanese|chinese|caucasian|elderly|" +
    // non-specific umbrella terms registries put first (Novo Nordisk: "Metabolism and Nutrition Disorder")
    "metabolism and nutrition|nutritional and metabolic|metabolic diseases?|nutrition disorders?|eating behaviou?r|" +
    "appetite|food intake|energy (?:intake|expenditure|balance)|glp-?1|glucagon-like peptide|receptor agonists?|" +
    // bariatric-surgery patients are obesity patients; the next item decides
    "bariatric|gastric bypass|sleeve gastrectomy|metabolic surgery)",
);
// Genetic / syndromic obesity: the syndrome is often listed before "obesity".
const OBESITY_SYNDROME_RE =
  /\b(?:bardet[- ]biedl|prader[- ]willi|alstr[oö]m|pomc|lepr|leptin (?:receptor )?deficien\w*|mc4r|melanocortin|hypothalamic|hyperphagia|monogenic|genetic obesity|smith[- ]magenis|sh2b1)\b/;
// Obesity named as the treated condition in a title (a noun, not "obese patients"),
// and not as a modifier ("obesity-related heart failure").
const TITLE_LEAD_RE =
  /\b(?:obesity(?![ -](?:associated|related|induced|linked|driven|mediated))|overweight|anti-?obesity|weight (?:loss|reduction|management|maintenance|control))\b/;
// Contexts where weight wording is about something other than obesity.
const NOT_OBESITY_CONTEXT_RE =
  /\b(?:lipodystroph\w*|lipohypertroph\w*|contracept\w*|antipsychotic|weight gain|cachexi\w*|anorexi\w*|wasting|sarcopeni\w*|malnutrition)\b/;

type Kind = "primary" | "comorbidity" | "weight" | "generic" | "syndrome" | "other";
interface ItemKind {
  c: string;
  kind: Kind;
  /** the other disease named (comorbidity / other items) */
  other?: string;
}

function itemKind(item: string): ItemKind {
  const v = classifyConditionItem(item);
  if (v.kind === "primary" || v.kind === "comorbidity") return { c: item, kind: v.kind, other: v.other };
  const t = foldText(item);
  if (OBESITY_SYNDROME_RE.test(t)) return { c: item, kind: "syndrome" };
  if (v.kind === "weight") return NOT_OBESITY_CONTEXT_RE.test(t) ? { c: item, kind: "other", other: item } : { c: item, kind: "weight" };
  const named = firstMatch(OTHER_RE, t.replace(/\b(?:renal|hepatic) impairment\b/g, " "));
  if (GENERIC_RE.test(t) && !named) return { c: item, kind: "generic" };
  return { c: item, kind: "other", other: firstMatch(OTHER_RE, t)?.term };
}

const titleText = (title?: string | null) => foldText(title ?? "").replace(NEGATED_OTHER_RE, " ");

// Obesity named as the thing being treated: "Treatment of Obesity…", "…for Weight Loss".
const TITLE_TREATS_RE =
  /\b(?:(?:treat\w*|management|therapy|reduc\w*|prevent\w*|control) (?:of |for )?(?:the )?(?:childhood |adolescent |adult |severe |morbid )?(?:obesity|overweight)|weight (?:loss|reduction|management|maintenance)|anti-?obesity)\b/;

/**
 * Does the title name obesity as the treated condition? Either it says so
 * ("Treatment of Obesity With Type 2 Diabetes", "…to Promote Weight Loss"), or it
 * names obesity and no other disease at all ("…in Adults With Obesity").
 * "NAION in Non-Diabetic Obese Patients" and "Lean and Overweight Youth With Type 1
 * Diabetes" do not count.
 */
export function titleLeadsWithObesity(title?: string | null): boolean {
  const t = titleText(title);
  if (!t || NOT_OBESITY_CONTEXT_RE.test(t)) return false;
  if (TITLE_TREATS_RE.test(t)) return true;
  return !!firstMatch(TITLE_LEAD_RE, t) && !firstMatch(OTHER_RE, t);
}

/** Does the title name obesity / overweight as a condition anywhere ("…Who Have Obesity")? */
function titleNamesObesity(title?: string | null): string | null {
  const t = titleText(title);
  if (!t || WASTING_RE.test(t) || /\b(?:lipodystroph|antipsychotic)\w*/.test(t)) return null;
  return firstMatch(TITLE_LEAD_RE, t)?.term ?? null;
}

// The enrolled population has obesity: "…Who Have Obesity", "Obese Participants With OSA".
const OBESE_POPULATION_RE =
  /\bobese (?:participants?|subjects?|adults?|patients?|people|individuals?|men|women|adolescents?|volunteers?)\b/;
const POPULATION_TERM_RE = /\b(?:obesity|overweight|anti-?obesity|weight (?:loss|reduction|management|maintenance|control))\b/;
function titleObesePopulation(title?: string | null): string | null {
  const t = titleText(title);
  if (!t || WASTING_RE.test(t) || /\b(?:lipodystroph|antipsychotic)\w*/.test(t)) return null;
  // includes "Obesity-related Heart Failure" — the participants have obesity
  return firstMatch(POPULATION_TERM_RE, t)?.term ?? firstMatch(OBESE_POPULATION_RE, t)?.term ?? null;
}

// Obesity-drug signal for industry trials: weight-loss drug classes by INN stem
// (-glutide, -dutide, -tirzepatide, -trutide, -glipron, -lintide…), named weight-loss
// drugs, or an investigational code name (XW003, HRS9531, LY3437943, NNC0487-0111).
const OBESITY_DRUG_RE =
  /\b(?:\w*(?:glutide|dutide|patide|trutide|glipron|lintide)|amycretin|setmelanotide|bimagrumab|phentermine|lorcaserin|orlistat|sibutramine|rimonabant|taranabant|tesofensine|naltrexone|bupropion|topiramate|cagrisema|maritide|incretin|amylin|glp-?1|glucagon-like peptide)\b/;
const CODE_NAME_RE = /\b(?!COVID)[A-Z]{2,6}[- ]?\d{2,}[A-Za-z0-9-]*\b/;
function obesityDrugSignal(title?: string | null, interventions: string[] = [], codeNames = true): string | null {
  for (const text of [...interventions, title ?? ""]) {
    const m = foldText(text).match(OBESITY_DRUG_RE) ?? (codeNames ? text.match(CODE_NAME_RE) : null);
    if (m) return m[0];
  }
  return null;
}

const short = (s?: string | null) => (s ?? "").slice(0, 120);

/**
 * Classify a trial from its condition list (in registry order) and brief title.
 *
 * A trial is PRIMARY when obesity is its LEAD condition: the first listed condition
 * (ignoring "Healthy volunteers", PK, "Metabolism and Nutrition Disorder" and similar
 * items) is obesity / overweight / a genetic-obesity syndrome. When another disease
 * is listed first (Alzheimer's, heart failure, PCOS, pregnancy…) obesity is a
 * comorbidity, unless the title names obesity as the treated condition first.
 *
 * `sponsorClass` = CT.gov lead sponsor class. INDUSTRY trials are competitor
 * intelligence, so they are also primary when:
 *   - obesity is listed as a condition, the title says the participants have obesity
 *     AND the drug is a weight-loss drug class or an investigational code name
 *     ("Tirzepatide in Participants With Type 2 Diabetes Who Have Obesity",
 *     "Ecnoglutide in Obese Participants With Knee Osteoarthritis") — obesity-drug
 *     programmes in obesity complications. Older trials of unrelated drugs in obese
 *     patients ("anticoagulants in obese patients with atrial fibrillation") stay out;
 *   - they are weight-loss / weight-management trials;
 *   - the conditions name no disease (healthy volunteers, PK, vague umbrella terms)
 *     and the title names obesity.
 */
export function classifyObesity(
  conditions: string[],
  sponsorClass?: string | null,
  title?: string | null,
  interventions: string[] = [],
): ObesityClassification {
  const items = splitConditions(conditions);
  const industry = String(sponsorClass ?? "").toUpperCase() === "INDUSTRY";
  const kinds = items.map(itemKind);
  const obesityItems = kinds.filter((k) => k.kind === "primary").map((k) => k.c);
  const syndromeItems = kinds.filter((k) => k.kind === "syndrome").map((k) => k.c);
  const comorbItems = kinds.filter((k) => k.kind === "comorbidity").map((k) => k.c);
  const weightItems = kinds.filter((k) => k.kind === "weight").map((k) => k.c);
  const namedDisease = kinds.some((k) => (k.kind === "other" || k.kind === "comorbidity") && k.other);
  // Lead condition = first item that names a condition (generic and weight items skipped).
  const lead = kinds.find((k) => k.kind !== "generic" && k.kind !== "weight");

  if (!items.length) {
    return industryTitle(industry, title, false, { class: "unrelated", reason: "No conditions listed.", terms: [] });
  }

  // 1. Obesity leads.
  if (lead?.kind === "primary") {
    return { class: "primary", reason: `Obesity is the lead condition: "${lead.c}".`, terms: obesityItems };
  }
  if (lead?.kind === "syndrome" && (obesityItems.length || titleNamesObesity(title) || /\bobes/.test(titleText(title)))) {
    return { class: "primary", reason: `Genetic / syndromic obesity: "${lead.c}".`, terms: [...syndromeItems, ...obesityItems] };
  }

  // 2. Obesity is listed, but another condition leads.
  if (lead && (obesityItems.length || comorbItems.length)) {
    const terms = obesityItems.length ? obesityItems : comorbItems;
    if (obesityItems.length && titleLeadsWithObesity(title)) {
      return {
        class: "primary",
        reason: `"${lead.c}" is listed first, but the title names obesity as the treated condition ("${short(title)}").`,
        terms,
      };
    }
    const pop = industry ? titleObesePopulation(title) : null;
    const drug = pop ? obesityDrugSignal(title, interventions) : null;
    if (pop && drug) {
      return {
        class: "primary",
        reason: `Industry obesity-drug trial (${drug}) in people with obesity and "${lead.c}" — the title names ${pop} ("${short(title)}").`,
        terms,
      };
    }
    return {
      class: "comorbidity",
      reason: `Obesity is a comorbidity — the lead condition is "${lead.c}" (obesity listed as "${terms[0]}").`,
      terms,
    };
  }

  // 3. No obesity condition.
  if (industry && lead) {
    // "Maridebart Cafraglutide in Participants With OSA Living With Overweight or Obesity"
    const pop = titleObesePopulation(title);
    const drug = pop ? obesityDrugSignal(title, interventions, false) : null;
    if (pop && drug) {
      return {
        class: "primary",
        reason: `Industry obesity-drug trial (${drug}) in people with obesity and "${lead.c}" — the title names ${pop} ("${short(title)}").`,
        terms: [],
      };
    }
  }
  if (industry && weightItems.length && !lead) {
    const loss = weightItems.filter((t) => firstMatch(WEIGHT_LOSS_RE, foldText(t)));
    if (loss.length) {
      return { class: "primary", reason: `Industry-sponsored weight-loss / weight-management trial: "${loss[0]}".`, terms: loss };
    }
  }
  if (industry && !namedDisease && titleLeadsWithObesity(title)) {
    // Vague conditions ("Cardiometabolic Disease", "Feeding and Eating Disorders",
    // "GLP-1 Receptor Agonists") but the title says "in Participants With Obesity".
    return {
      class: "primary",
      reason: `Industry-sponsored; the conditions name no specific disease and the title names obesity ("${short(title)}").`,
      terms: [],
    };
  }
  const base: ObesityClassification = weightItems.length
    ? { class: "weight_related", reason: lead ? `Weight-related wording, but the lead condition is "${lead.c}".` : `No obesity condition, but weight-related: "${weightItems[0]}".`, terms: weightItems }
    : lead
      ? { class: "unrelated", reason: `No obesity or weight term in the conditions (first: "${items[0]}").`, terms: [] }
      : { class: "unrelated", reason: `Healthy-volunteer / pharmacology study with no indication listed ("${items[0]}").`, terms: [] };
  return lead ? base : industryTitle(industry, title, kinds.some((k) => NOT_OBESITY_CONTEXT_RE.test(foldText(k.c))), base);
}

/**
 * Industry obesity-drug studies in healthy volunteers / PK populations often name
 * obesity only in the title. Used only when the conditions name no disease at all.
 */
function industryTitle(industry: boolean, title: string | null | undefined, badContext: boolean, base: ObesityClassification): ObesityClassification {
  if (!industry || badContext) return base;
  const t = titleText(title);
  if (!t || !TITLE_OBESITY_RE.test(t) || WASTING_RE.test(t) || /\b(?:lipodystroph|antipsychotic)\w*/.test(t)) return base;
  const m = t.match(TITLE_OBESITY_RE)?.[0] ?? "obesity";
  return { class: "primary", reason: `Industry-sponsored; no disease listed and the title names ${m} ("${short(title)}").`, terms: base.terms };
}

/** True when at least one condition of the trial is a primary obesity indication. */
export function isObesityIndication(
  conditions: string[], sponsorClass?: string | null, title?: string | null, interventions: string[] = [],
): boolean {
  return classifyObesity(conditions, sponsorClass, title, interventions).class === "primary";
}
