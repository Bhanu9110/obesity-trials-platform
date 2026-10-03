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

export const CLASSIFIER_VERSION = "obesity-2.0";

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
const WEIGHT_RE = termRegex(WEIGHT_TERMS);

function firstMatch(re: RegExp, t: string): { index: number; term: string } | null {
  re.lastIndex = 0;
  const m = re.exec(t);
  return m ? { index: m.index, term: m[0] } : null;
}

type ItemVerdict = { kind: "primary" | "comorbidity" | "weight" | "none"; other?: string };

/** Classify ONE condition item. */
export function classifyConditionItem(item: string): ItemVerdict {
  const t = foldText(item);
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

/** Classify a trial from its condition list. */
export function classifyObesity(conditions: string[]): ObesityClassification {
  const items = (conditions || []).filter((c) => c && c.trim());
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
export function isObesityIndication(conditions: string[]): boolean {
  return classifyObesity(conditions).class === "primary";
}
