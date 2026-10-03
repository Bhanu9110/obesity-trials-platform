// Obesity classification of a trial, judged from its condition / indication list.
//
//   primary        obesity (or an in-scope indication) is the PRIMARY condition
//   comorbidity    obesity is mentioned, but as context of another disease
//                  ("obesity-related hypertension", "type 2 diabetes in obese adults")
//   weight_related no in-scope term, but weight-management terms (weight loss, BMI…)
//   unrelated      none of the above (CT.gov's "obesity" search matched other fields)
//
// Nothing is deleted: every trial is stored with its class and the reason, and the
// website shows `primary` trials by default. Bump CLASSIFIER_VERSION when the rules
// change — stored trials are then re-classified automatically (no download).
//
// In-scope indications: obesity, obese, overweight, morbid obesity, hyperlipidemia,
// dyslipidemia.

export const CLASSIFIER_VERSION = "obesity-2.1";
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
  const t = foldText(item).replace(NEGATED_OTHER_RE, " ");
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

/**
 * Classify a trial from its condition list. `sponsorClass` = CT.gov lead sponsor
 * class: INDUSTRY trials are competitor intelligence, so any obesity / weight-loss
 * mention makes them primary.
 */
export function classifyObesity(
  conditions: string[],
  sponsorClass?: string | null,
  title?: string | null,
): ObesityClassification {
  const base = classifyBase(conditions);
  if (String(sponsorClass ?? "").toUpperCase() !== "INDUSTRY" || base.class === "primary") return base;
  if (base.class === "comorbidity") {
    return {
      class: "primary",
      reason: `Industry-sponsored; obesity is named with another condition: "${base.terms[0]}".`,
      terms: base.terms,
    };
  }
  if (base.class === "weight_related") {
    const loss = base.terms.filter((t) => firstMatch(WEIGHT_LOSS_RE, foldText(t)));
    if (loss.length) {
      return { class: "primary", reason: `Industry-sponsored weight-loss / weight-management trial: "${loss[0]}".`, terms: loss };
    }
  }
  // Industry trials of obesity drugs in healthy volunteers, drug-interaction studies,
  // or other populations often say "obesity" only in the title.
  const t = foldText(title ?? "");
  if (t && TITLE_OBESITY_RE.test(t) && !WASTING_RE.test(t) && !conditions.some((c) => WASTING_RE.test(foldText(c)))) {
    const m = t.match(TITLE_OBESITY_RE)?.[0] ?? "obesity";
    return { class: "primary", reason: `Industry-sponsored; the title names ${m} ("${(title ?? "").slice(0, 120)}").`, terms: base.terms };
  }
  return base;
}

function classifyBase(conditions: string[]): ObesityClassification {
  const items = splitConditions(conditions);
  if (!items.length) {
    return { class: "unrelated", reason: "No conditions listed.", terms: [] };
  }
  const verdicts = items.map((c) => ({ c, v: classifyConditionItem(c) }));
  const primary = verdicts.filter((x) => x.v.kind === "primary").map((x) => x.c);
  if (primary.length) {
    return { class: "primary", reason: `Obesity is a primary condition: "${primary[0]}".`, terms: primary };
  }
  const comorb = verdicts.filter((x) => x.v.kind === "comorbidity");
  if (comorb.length) {
    const first = comorb[0];
    return {
      class: "comorbidity",
      reason: `Obesity is mentioned as context of another disease (${first.v.other}): "${first.c}".`,
      terms: comorb.map((x) => x.c),
    };
  }
  const weight = verdicts.filter((x) => x.v.kind === "weight").map((x) => x.c);
  if (weight.length) {
    return {
      class: "weight_related",
      reason: `No obesity condition, but weight-related: "${weight[0]}".`,
      terms: weight,
    };
  }
  return {
    class: "unrelated",
    reason: `No obesity or weight term in the conditions (first: "${items[0]}").`,
    terms: [],
  };
}

/** True when at least one condition of the trial is a primary obesity indication. */
export function isObesityIndication(conditions: string[], sponsorClass?: string | null, title?: string | null): boolean {
  return classifyObesity(conditions, sponsorClass, title).class === "primary";
}
