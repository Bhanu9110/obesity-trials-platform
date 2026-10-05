// A drug's profile for the Drugs list: every column is the value entered by hand on
// the drug page, or — while that is blank — an automatic suggestion worked out from
// the trial data and the built-in reference list (drug-reference.ts). Suggestions are
// marked auto so the website can show them in grey.

import type { DrugProfile, ProductInfo, ProductTrialFacts, ProfileValue } from "./types";
import { drugReference } from "./drug-reference";

type Input = ProductInfo & ProductTrialFacts & { slug: string; name: string };

const manual = (v: string | null | undefined): ProfileValue | null => (v?.trim() ? { value: v.trim(), auto: false } : null);
const auto = (v: string | null | undefined, why?: string): ProfileValue => (v ? { value: v, auto: true, why } : { value: null, auto: true });

/** "ly3298176" -> "LY3298176" (manual alias merges are stored as slugs). */
const aliasLabel = (slug: string) => (/\d/.test(slug) ? slug.toUpperCase() : slug.charAt(0).toUpperCase() + slug.slice(1));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(norm(x)) ? false : (seen.add(norm(x)), true)));
};
// An investigational code name rather than an INN: "HRS9531", "AZD6234", "BI 456906".
const CODE_NAME = /^[A-Z]{1,6}[- ]?\d{2,}/;

// Long-established generic drugs (often probe drugs in drug-interaction studies or
// anaesthesia / supportive care in obesity trials): never pipeline candidates.
const GENERIC_STEMS = /(statin|sartan|pril|olol|dipine|azepam|zolam|oxetine|triptyline|profen|cillin|mycin|floxacin|prazole|tidine|setron|curonium|caine|azole|thiazide|semide|olone|sone|parin|fibrate|gliflozin|gliptin|glitazone|glinide|metformin|vitamin|calciferol)$/;
const GENERICS = new Set([
  "acetaminophen", "paracetamol", "aspirin", "caffeine", "warfarin", "digoxin", "midazolam", "propofol", "ketamine",
  "dexmedetomidine", "fentanyl", "remifentanil", "morphine", "sugammadex", "neostigmine", "dexamethasone", "ondansetron",
  "ethinylestradiol", "levonorgestrel", "estradiol", "testosterone", "levothyroxine", "dextromethorphan", "montelukast",
  "furosemide", "dabigatran", "rivaroxaban", "apixaban", "enoxaparin", "heparin", "metoprolol", "omeprazole",
  "cholecalciferol", "ergocalciferol", "folicacid", "melatonin", "oxytocin", "glucose", "insulin", "metformin",
  "fluoxetine", "sertraline", "bupropion", "naltrexone", "topiramate", "zonisamide", "phentermine", "lorcaserin",
]);

/** Merge spelling variants of the same condition and drop non-indications. */
function cleanConditions(cs: string[]): string[] {
  const out: string[] = [];
  for (const raw of cs) {
    let c = raw.replace(/^\s*\d+[.)]\s*/, "").replace(/\s*\((disorder|finding|disease)\)\s*$/i, "").trim();
    const l = c.toLowerCase();
    if (/^(healthy|healthy volunteers?|metabolism and nutrition disorders?|nutritional and metabolic diseases?|weight loss|body weight|drug)$/.test(l)) continue;
    if (/^(obes(e|ity)|overweight|adult obesity|obesity,? (adult|morbid)|morbid obesity|severe obesity|(overweight|obesity)\s*(and|or|&|,|\/)\s*(obes(e|ity)|overweight)|chronic weight management|chronic management of body weight)$/.test(l)) c = "Obesity";
    else if (/(type 2|type ii|non-insulin-dependent|adult-onset).*diabet|diabet.*(type 2|type ii|t2dm)|^t2dm$/.test(l)) c = "Type 2 diabetes";
    else if (/obstructive sleep apn/.test(l)) c = "Obstructive sleep apnea";
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out.slice(0, 3);
}

/** "Eli Lilly and Company" -> "Eli Lilly", "Novo Nordisk A/S" -> "Novo Nordisk". */
export function companyName(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 3; i++) {
    out = out.replace(/[\s,]+(and company|& co\.?|inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|co\.?,? ?ltd\.?|co\.?|corp\.?|corporation|a\/s|ag|gmbh|plc|s\.?a\.?|s\.?p\.?a\.?|b\.?v\.?|n\.?v\.?|k\.?k\.?|ab|oy)$/i, "").replace(/\.$/, "").trim();
  }
  return out || s;
}

export function drugProfile(p: Input): DrugProfile {
  const ref = drugReference(p.slug, p.name);
  const isUndisclosed = p.slug.startsWith("undisclosed");
  const isCombo = p.name.includes(" + ");
  const brands = ref?.brands ?? [];

  const aliasAuto = uniq([...(ref?.aliases ?? []), ...p.alias_slugs.map(aliasLabel)])
    .filter((a) => !brands.some((b) => norm(b) === norm(a)) && norm(a) !== norm(p.name));

  // Pipeline = still in development. Non-pipeline = marketed / generic / withdrawn / discontinued.
  let candidate: ProfileValue;
  if (isUndisclosed) candidate = auto(null, "An undisclosed drug — set it by hand once the drug is known.");
  else if (p.approved === "Yes") candidate = auto("Non-pipeline", "Marked approved on the drug page.");
  else if (ref?.status) candidate = auto("Non-pipeline", `Reference list: ${ref.status}.`);
  else if (p.has_phase4) candidate = auto("Non-pipeline", "Has phase 4 (post-marketing) trials, so it is on the market somewhere.");
  else if (p.approved === "No") candidate = auto("Pipeline", "Marked not approved on the drug page.");
  else if (CODE_NAME.test(p.name)) candidate = auto("Pipeline", "Investigational code name, no phase 4 trials.");
  else if (isCombo && p.name.split(" + ").every((c) => CODE_NAME.test(c) || !GENERICS.has(norm(c)))) {
    candidate = p.solo_industry_trials > 0
      ? auto("Pipeline", "Combination tested in its own industry trials, none in phase 4.")
      : auto("Non-pipeline", "Combination not in its own industry trials.");
  }
  else if (GENERICS.has(norm(p.name)) || GENERIC_STEMS.test(norm(p.name))) candidate = auto("Non-pipeline", "Long-established generic drug.");
  else if (p.solo_industry_trials > 0) candidate = auto("Pipeline", "A company runs its own trials of it (not just as a companion drug), none in phase 4.");
  else candidate = auto("Non-pipeline", "Tested only by academic groups, or by companies only alongside another drug — usually an existing drug, not a pipeline candidate.");

  let parent: ProfileValue = auto(null);
  if (isCombo) parent = auto(p.name.split(" + ").join(", "), "Components of this combination.");
  else if (isUndisclosed) parent = auto(`Any ${p.name.replace(/^Undisclosed\s+/i, "")}`, "The sponsor named only the drug class.");

  // The company is the sponsor that develops it — not a sponsor that only used it as a
  // companion / probe drug, and not one of many makers of a generic.
  const company = ref?.company
    ? auto(ref.company, "Reference list (originator / main marketing company).")
    : p.top_industry_sponsor && candidate.value === "Pipeline"
      ? auto(companyName(p.top_industry_sponsor), `Most frequent industry sponsor of its own trials (${p.solo_industry_trials} of ${p.industry_trials} industry trial${p.industry_trials === 1 ? "" : "s"}).`)
      : auto(null, candidate.value === "Non-pipeline" ? "Generic or marketed by several companies — enter one by hand if needed." : "No industry-sponsored trials.");

  return {
    aliases: manual(p.aliases) ?? auto(aliasAuto.join(", ") || null, "Reference list and manual drug merges."),
    brands: manual(p.brand_names) ?? auto(brands.join(", ") || null, "Reference list."),
    candidate: manual(p.candidate) ?? candidate,
    parent: manual(p.parent_drug) ?? parent,
    company: manual(p.sponsor) ?? company,
    therapyClass: manual(p.drug_class) ?? auto(ref?.cls ?? null, "Reference list / drug-name stem."),
    therapySubclass: manual(p.therapy_subclass) ?? auto(ref?.sub ?? null, "Reference list / drug-name stem."),
    indication: manual(p.indication) ?? auto(cleanConditions(p.top_conditions).join(", ") || null, "Most frequent conditions of its obesity trials."),
  };
}
