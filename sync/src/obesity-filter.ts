// Primary-obesity-indication filter.
//
// A trial counts as an obesity trial only when obesity (or an in-scope metabolic
// indication) is the PRIMARY condition being studied — not when obesity is a
// comorbidity of another disease ("type 2 diabetes in obese patients") or just a
// subject descriptor. Judged from the condition/indication field only.
//
// In-scope keywords: obesity, obese, overweight, morbid obesity, hyperlipidemia,
// dyslipidemia.
export const OBESITY_INDICATION_ROOTS = ["obes", "overweight", "hyperlipid", "dyslipid"];
// If a condition item names one of THESE other diseases, obesity there is a
// comorbidity/subject context, so that item does not count as an obesity indication.
const OTHER_DISEASE_TERMS = [
  "diabet", "nash", "nafld", "mash", "steatohepat", "steatosis", "fatty liver",
  "hypertens", "blood pressure", "cardiovascular", "coronary", "heart failure",
  "myocardial", "angina", "arrhythmia", "atrial fib", "stroke",
  "cancer", "carcinoma", "tumour", "tumor", "neoplas", "oncolog", "leukemia", "leukaemia",
  "lymphoma", "melanoma",
  "arthritis", "osteoarthr", "rheumatoid", "osteoporos", "gout",
  "depress", "schizophren", "bipolar", "anxiety", "psychiat", "psychosis",
  "infertil", "fertilit", "pregnan", "gestational", "menopaus", "polycystic", "pcos",
  "asthma", "copd", "respiratory", "apnoea", "apnea", "sleep",
  "psoriasis", "dermatit", "eczema",
  "kidney", "renal", "nephro", "ckd", "cirrhosis", "hepatitis",
  "migraine", "epilep", "seizure", "alzheimer", "dementia", "parkinson", "sclerosis",
  "hiv", "transplant", "covid", "influenza", "thyroid", "anaemia", "anemia",
];

function foldText(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function earliestIndex(t: string, terms: string[]): number {
  let best = -1;
  for (const w of terms) {
    const i = t.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/** True when a single condition item is PRIMARILY an in-scope obesity indication. */
export function isObesityConditionItem(item: string): boolean {
  const t = foldText(item);
  const obesIdx = earliestIndex(t, OBESITY_INDICATION_ROOTS);
  if (obesIdx < 0) return false;                      // no obesity/in-scope term at all
  const otherIdx = earliestIndex(t, OTHER_DISEASE_TERMS);
  if (otherIdx < 0) return true;                      // pure in-scope condition

  // Another disease is named too — decide whether obesity is the indication or context:
  // obesity used as a modifier of another disease ("obesity-associated hypertension",
  // "obesity-related NAFLD") -> the other disease is the indication.
  if (/obes\w*[ -](associated|related|induced|linked|driven|due to)/.test(t)) return false;
  // other diseases framed as comorbidities of the obese population -> obesity is primary.
  if (/comorbid|co-morbid|coexist|co-exist|concomitant|risk factor|complication/.test(t)) return true;
  // otherwise: obesity is primary only if it clearly LEADS the description.
  return obesIdx < otherIdx && obesIdx <= 15;
}

/** True when at least one condition of the trial is a primary obesity indication. */
export function isObesityIndication(conditions: string[]): boolean {
  return (conditions || []).some(isObesityConditionItem);
}
