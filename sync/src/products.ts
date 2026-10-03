// Drug/product derivation from CT.gov intervention names.
//
// CT.gov intervention names are free text ("Semaglutide 2.4 mg", "Semaglutide Pen
// Injector", "Placebo (semaglutide)", "HRS9531 injection", "Phentermine-Topiramate",
// "rimonabant (SR141716)", "aleniglipron or placebo" ...). This module turns them
// into stable PRODUCTS so every trial of the same drug lands on one drug page:
//
//   - placebo / saline / vehicle / sham names are dropped
//   - dose, formulation, route, frequency and salt words are stripped
//   - "A + B", "A/B", "A and B", "A-B" become one combination product "A + B"
//   - "A or B" becomes two separate products
//   - brand names and well-known code names fold into their INN (aliases),
//     and extra merges can be added in the product_aliases table
//
// Bump PRODUCT_RULES_VERSION whenever these rules change: the scheduler then
// rebuilds trial_products automatically on its next start. Manually entered
// product info is keyed by product slug and is never touched by a rebuild.

export const PRODUCT_RULES_VERSION = "2"; // 2: "A ; Placebo" lists split on semicolons

export interface ProductRef {
  slug: string; // normalized key (also used in the drug-page URL)
  name: string; // display name
}

export type AliasMap = Map<string, ProductRef>;

// --------------------------------------------------------------------------- #
// Built-in aliases: brand names and code names whose INN is well established.
// Keys are slugs (lower-case, alphanumerics only).
// --------------------------------------------------------------------------- #
const SEMA: ProductRef = { slug: "semaglutide", name: "Semaglutide" };
const LIRA: ProductRef = { slug: "liraglutide", name: "Liraglutide" };
const TIRZ: ProductRef = { slug: "tirzepatide", name: "Tirzepatide" };
const PHEN_TPM: ProductRef = { slug: "phentermine_topiramate", name: "Phentermine + Topiramate" };
const BUP_NAL: ProductRef = { slug: "bupropion_naltrexone", name: "Bupropion + Naltrexone" };
const CAGRI: ProductRef = { slug: "cagrilintide", name: "Cagrilintide" };
const MAZ: ProductRef = { slug: "mazdutide", name: "Mazdutide" };
const RIMO: ProductRef = { slug: "rimonabant", name: "Rimonabant" };
const SETM: ProductRef = { slug: "setmelanotide", name: "Setmelanotide" };

export const BUILTIN_ALIASES: Record<string, ProductRef> = {
  // brands
  wegovy: SEMA, ozempic: SEMA, rybelsus: SEMA,
  saxenda: LIRA, victoza: LIRA,
  mounjaro: TIRZ, zepbound: TIRZ,
  qsymia: PHEN_TPM, qnexa: PHEN_TPM, vi0521: PHEN_TPM,
  contrave: BUP_NAL, mysimba: BUP_NAL,
  xenical: { slug: "orlistat", name: "Orlistat" }, alli: { slug: "orlistat", name: "Orlistat" },
  imcivree: SETM, rm493: SETM,
  byetta: { slug: "exenatide", name: "Exenatide" }, bydureon: { slug: "exenatide", name: "Exenatide" },
  trulicity: { slug: "dulaglutide", name: "Dulaglutide" },
  belviq: { slug: "lorcaserin", name: "Lorcaserin" },
  meridia: { slug: "sibutramine", name: "Sibutramine" }, reductil: { slug: "sibutramine", name: "Sibutramine" },
  acomplia: RIMO, sr141716: RIMO, sr141716a: RIMO,
  symlin: { slug: "pramlintide", name: "Pramlintide" },
  glucophage: { slug: "metformin", name: "Metformin" },
  cagrisema: { slug: "cagrilintide_semaglutide", name: "Cagrilintide + Semaglutide" },
  // development codes -> INN
  ly3298176: TIRZ,
  ly3437943: { slug: "retatrutide", name: "Retatrutide" },
  ly3502970: { slug: "orforglipron", name: "Orforglipron" },
  ly3305677: MAZ, ibi362: MAZ,
  bi456906: { slug: "survodutide", name: "Survodutide" },
  amg133: { slug: "maridebartcafraglutide", name: "Maridebart Cafraglutide" },
  nnc01740833: CAGRI, am833: CAGRI,
  nnc04870111: { slug: "amycretin", name: "Amycretin" },
  zp8396: { slug: "petrelintide", name: "Petrelintide" },
  xw003: { slug: "ecnoglutide", name: "Ecnoglutide" },
  gsbr1290: { slug: "aleniglipron", name: "Aleniglipron" },
  alt801: { slug: "pemvidutide", name: "Pemvidutide" },
  bym338: { slug: "bimagrumab", name: "Bimagrumab" },
  kai9531: { slug: "hrs9531", name: "HRS9531" },
  pf06882961: { slug: "danuglipron", name: "Danuglipron" },
  pf07081532: { slug: "lotiglipron", name: "Lotiglipron" },
  mk0364: { slug: "taranabant", name: "Taranabant" },
  cp945598: { slug: "otenabant", name: "Otenabant" },
};

export function builtinAliasMap(): AliasMap {
  return new Map(Object.entries(BUILTIN_ALIASES));
}

// --------------------------------------------------------------------------- #
// Word lists
// --------------------------------------------------------------------------- #
// A list part containing any of these describes an activity or outcome, not a drug.
const NON_DRUG_PART_RE = /\b(improvement|improving|management|lifestyle|diet(ary)? (advice|counsel\w*)|exercise|education|counsel\w*|usual care|standard (of )?care|best medical|follow[- ]?up|monitoring|assessment)\b/i;

// A name containing any of these is a placebo/control, not a product.
const PLACEBO_RE = /\b(placebos?|saline|vehicle|sham|dummy|mock|matching|matched)\b/i;

// Whole-name non-drug or class-only entries (checked after cleaning).
const NON_PRODUCT_RE = new RegExp(
  "^(" +
    [
      "exercise", "diet", "diets", "lifestyle", "lifestyle intervention", "lifestyle modification",
      "behavioral therapy", "behavioural therapy", "counseling", "counselling",
      "standard of care", "standard care", "usual care", "best supportive care",
      "control", "observation", "education", "physical activity",
      "obesity", "overweight", "weight loss", "water", "food", "meal", "breakfast", "lunch", "dinner", "study", "anesthesia", "anaesthesia",
      "(dual |triple )?(gip|glp-?1|glp|gcg|gcgr|glp-?1r)( ?\\+ ?(gip|glp-?1|gcg))*( receptor)?( agonists?| ras?| analogu?es?| analogs?| agonist therapy| therapy| medications?)?",
      "(dual |triple )?(glucagon|amylin)( receptor)? (agonists?|analogu?es?|analogs?)",
      "glucagon-like peptide-?1( receptor)?( agonists?| analogu?es?)?",
      "(sglt-?2|dpp-?4)( inhibitors?)?", "statins?", "insulin secretagogues?",
      "anti-?obesity", "anti-?obesity (drugs?|medications?)", "weight loss (drugs?|medications?)",
      "anti-?hypertensives?", "anti-?hypertensive (drugs?|medications?)",
      "investigational (drug|product|medicinal product)", "active comparator", "comparator",
      "drug", "drugs", "medication", "medications", "medicine", "treatment", "pharmacotherapy",
      "background therapy", "rescue medication", "other", "none", "n/?a", "test", "reference",
    ].join("|") +
    ")$",
  "i",
);

// Tokens removed from a name when at least one other token remains.
const STRIP_TOKENS = new Set([
  // formulation / device
  "injection", "injections", "injectable", "inj", "injector", "autoinjector", "auto-injector", "pen",
  "pens", "pen-injector", "prefilled", "pre-filled", "syringe", "product", "tablet", "tablets", "tab",
  "tabs", "capsule", "capsules", "cap", "caps", "solution", "suspension", "infusion", "drops",
  "spray", "cream", "gel", "patch", "film-coated", "coated", "granules", "powder", "formulation",
  "chewable", "vial", "liquid", "frozen", "lyophilized",
  // route
  "oral", "orally", "subcutaneous", "subcutaneously", "sc", "s.c.", "s.c", "iv", "i.v.", "intravenous",
  "intravenously", "intramuscular", "im", "nasal", "intranasal", "transdermal", "topical", "sublingual",
  // release
  "extended-release", "extended", "release", "er", "xr", "xl", "ir", "sr", "sustained",
  "delayed-release", "dr", "modified",
  // frequency / regimen
  "once", "twice", "daily", "weekly", "monthly", "qw", "eqw", "q2w", "q4w", "qd", "bid", "tid", "od",
  "qod", "ttd", "day", "days", "week", "weeks", "per", "kg", "ml", "up", "to",
  "dose", "doses", "dosing", "low", "high", "standard", "fixed", "titration", "titrated",
  "maintenance", "regimen", "arm", "group", "cohort", "part", "treatment", "therapy", "active",
  "generic", "brand", "alfa", "combination", "combined", "medication", "medications", "drug",
  "administration", "administered", "experimental", "label", "per-label", "flexible",
  "microdose", "ingestion", "intake", "only", "alone", "monotherapy",
  // salts / hydrates
  "hydrochloride", "hcl", "acetate", "mesylate", "dimesylate", "maleate", "tartrate", "bitartrate",
  "succinate", "citrate", "phosphate", "sulfate", "sulphate", "monohydrate", "dihydrate", "besylate",
  "fumarate", "hydrobromide", "hemihydrate", "anhydrous",
  // filler
  "for", "of", "the", "a", "an", "in", "on", "use", "as", "is", "by", "at", "be", "will", "and",
]);

// INN stems that mark a token as a drug name (used to pull the drug out of free text).
const INN_STEM_RE =
  /(glutide|lintide|patide|dutide|natide|glipron|gliflozin|gliptin|formin|mab|statin|sartan|pril|dipine|lorcaserin|xetine|zepam|zolam|afil|parin|caine|olol|tidine|prazole|semaglutide|tirzepatide)$/i;
// Development code: letters + digits, e.g. HRS9531, NNC0487-0111, AZD6234, VK2735.
const CODE_RE = /^[A-Za-z]{1,6}-?\d{2,}[A-Za-z0-9-]*$/;
// A fragment mentioning any of these is a procedure / behavioural element, not a drug.
const NON_DRUG_WORDS_RE =
  /\b(lifestyle|counsel+ing|exercise|diet|dietary|education|educational|program|programme|walk|test|testing|study|studied|intervention|surgery|gastrectomy|bypass|ultrasound|scan|mri|biopsy|clamp|assessment|booklet|coaching|music|app|device|questionnaire)\b/i;
// Words that mark a fragment as a sentence / instruction rather than a drug name.
const FREE_TEXT_RE =
  /\b(are|is|was|were|be|been|according|determined|based|prescrib\w*|practices?|physicians?|investigators?|discretion|clinical|routine|usual|receive[sd]?|given|will|may|can|should|who|which|that|their|patients?|participants?|subjects?|during|after|before|prior|until|then|each|every|reduce[sd]?|start|stop)\b/i;
// Ordinary words that must never be taken for a drug name inside free text.
const COMMON_WORDS = new Set([
  "care", "human", "standard", "usual", "routine", "clinical", "physician", "obesity", "obese",
  "weight", "loss", "patients", "patient", "healthy", "volunteers", "adults", "children", "women",
  "men", "meal", "glucose", "fat", "protein", "oil", "acid", "vitamin", "hormone", "growth",
  "recombinant", "intervention", "program", "programme", "management", "block", "nerve", "surgery",
  "insulin", "treating", "duration", "determined", "part", "trial", "study", "based", "early",
  "late", "single", "multiple", "challenge", "tolerance", "induction", "maintenance", "clamp",
]);
// Salt / counter-ion words dropped when they END a multi-word name ("Rosuvastatin Calcium").
const SALT_TAIL = new Set(["calcium", "sodium", "potassium", "magnesium", "disodium", "meglumine"]);
// Class abbreviations that look like codes but are not products.
const CLASS_CODES = new Set(["glp1", "glp1r", "sglt2", "dpp4", "gip", "gcg", "gcgr", "ccr5", "pcsk9", "fgf21", "mc4r", "cb1"]);

// Dose expressions: "2.4 mg", "10mg/kg", "50 µg", "100 IU", "0.5%", "6Mg/Ml", "3.75Mg-23Mg" ...
const DOSE_RE =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|ug|g|kg|ml|l|iu|units?|u|mmol|nmol|%)(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:kg|day|d|week|wk|ml|m2|dose|l))?(?=\b|[^a-z])/gi;
// "every 2 weeks", "q 2 weeks", "x 12 weeks", "for 26 weeks"
const SCHEDULE_RE = /\b(?:every|q|x|for|over)\s*\d+\s*(?:days?|weeks?|wks?|months?)\b/gi;

// --------------------------------------------------------------------------- #
// Helpers
// --------------------------------------------------------------------------- #
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function prettyToken(tok: string): string {
  if (/^[a-z]+$/.test(tok)) return tok.charAt(0).toUpperCase() + tok.slice(1); // inn -> Inn
  if (/^[a-z0-9-]+$/.test(tok) && /\d/.test(tok) && /[a-z]/.test(tok)) return tok.toUpperCase(); // ly3437943 -> LY3437943
  return tok;
}
function prettyName(tokens: string[]): string {
  return tokens.map((t) => (t === t.toLowerCase() ? prettyToken(t) : t)).join(" ");
}

/** Normalize unicode punctuation (full-width Chinese colon/semicolon/brackets etc.). */
function asciiPunct(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[（［【]/g, "(")
    .replace(/[）］】]/g, ")")
    .replace(/[；]/g, ";")
    .replace(/[：]/g, ":")
    .replace(/[，、]/g, ",")
    .replace(/[＋]/g, "+")
    .replace(/[®™©]/g, " ")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove brackets, doses, schedules and stray punctuation from a name fragment. */
function scrub(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[()[\]]/g, " ")
    .replace(DOSE_RE, " ")
    .replace(SCHEDULE_RE, " ")
    .replace(/[“”"'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s.,+/&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into tokens and drop removable words / arm numbers while something meaningful remains. */
function meaningfulTokens(fragment: string): string[] {
  const toks = fragment
    .split(" ")
    .map((t) => t.replace(/^[.,-]+|[.,-]+$/g, ""))
    .filter(Boolean);
  const keep: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (STRIP_TOKENS.has(t.toLowerCase())) continue;
    if (/^\d+(?:[.,]\d+)?$/.test(t)) {
      // Keep the number part of a spaced code ("BI 456906", "AMG 133", "NNC0174 0833");
      // drop arm numbers and bare doses ("MWN109 1", "Metformin 1000").
      const prev = keep[keep.length - 1];
      const prevIsPrefix = prev && (/^[A-Z]{2,5}$/.test(prev) || CODE_RE.test(prev));
      if (t.replace(/\D/g, "").length >= 3 && prevIsPrefix) keep.push(t);
      continue;
    }
    // Dose/arm labels after a code: "ACI-19764 A3", "GZR18 A".
    if (/^[A-Za-z]\d?$/.test(t) && keep.length && CODE_RE.test(keep[keep.length - 1])) continue;
    keep.push(t);
  }
  if (keep.length > 1 && SALT_TAIL.has(keep[keep.length - 1].toLowerCase())) keep.pop();
  return keep;
}

interface Ctx {
  aliases: AliasMap;
  known: Set<string>; // slugs of established products (for pulling drugs out of free text)
}

function isDrugToken(tok: string, ctx: Ctx): boolean {
  const sl = slugify(tok);
  if (sl.length < 3 || CLASS_CODES.has(sl) || COMMON_WORDS.has(sl)) return false;
  if (ctx.known.has(sl) || ctx.aliases.has(sl)) return true;
  if (tok.length >= 7 && INN_STEM_RE.test(tok)) return true;
  return CODE_RE.test(tok) && /[A-Za-z]{2}/.test(tok);
}

/**
 * Resolve one combination-free fragment into component product(s).
 * Usually one product; a free-text fragment may yield the drug(s) it mentions.
 */
function resolveFragment(fragment: string, ctx: Ctx): ProductRef[] {
  if (!fragment.trim() || PLACEBO_RE.test(fragment)) return [];
  // "no tirzepatide" / "without metformin" describe an absent drug.
  if (/^\s*(no|without|non)\s+[a-z]/i.test(fragment)) return [];
  const scrubbed = scrub(fragment);
  if (NON_DRUG_WORDS_RE.test(scrubbed)) {
    // "Tirzepatide as an adjunct to lifestyle intervention" -> Tirzepatide
    const drugs = meaningfulTokens(scrubbed).filter((t) => isDrugToken(t, ctx));
    return drugs.map((d) => ctx.aliases.get(slugify(d)) ?? { slug: slugify(d), name: prettyName([d]) });
  }
  if (NON_PRODUCT_RE.test(scrubbed) || /\b(standard|usual|routine|best supportive) (of )?care\b/i.test(scrubbed)) return [];
  const toks = meaningfulTokens(scrubbed);
  if (!toks.length) return [];
  const cleaned = toks.join(" ").replace(/,(?=\d)/g, ""); // CP-945,598 -> CP-945598
  if (NON_PRODUCT_RE.test(cleaned)) return [];
  const slug = slugify(cleaned);
  if (slug.length < 2 || /^\d+$/.test(slug)) return [];

  const whole = ctx.aliases.get(slug);
  if (whole) return [whole];
  if (ctx.known.has(slug)) return [{ slug, name: prettyName(cleaned.split(" ")) }];

  // "Phentermine-Topiramate" -> two components.
  if (/^[A-Za-z]{5,}(-[A-Za-z]{5,})+$/.test(cleaned)) {
    return cleaned.split("-").flatMap((p) => resolveFragment(p, ctx));
  }

  // Longer phrases: pull out the drug name(s) they mention, else treat as free text.
  if (toks.length >= 3) {
    const drugs = toks.filter((t) => isDrugToken(t, ctx));
    if (drugs.length) {
      return drugs.map((d) => ctx.aliases.get(slugify(d)) ?? { slug: slugify(d), name: prettyName([d]) });
    }
    if (toks.length > 5 || FREE_TEXT_RE.test(scrubbed)) return []; // a sentence with no recognisable drug
  }
  return [{ slug, name: prettyName(cleaned.split(" ")) }];
}

// Combination separators (one product made of several drugs).
const COMBO_SPLIT_RE = /\s*\+\s*|\s+plus\s+|\s+and\s+|\s*&\s*|\s+with\s+|\s*\/\s*/i;

function uniq(ps: ProductRef[]): ProductRef[] {
  const m = new Map<string, ProductRef>();
  for (const p of ps) if (!m.has(p.slug)) m.set(p.slug, p);
  return [...m.values()];
}

/**
 * Derive the product(s) named by ONE intervention name.
 * Returns [] for placebo/control/non-drug names.
 */
export function productsFromName(
  rawName: string,
  aliases: AliasMap = builtinAliasMap(),
  known: Set<string> = new Set(),
): ProductRef[] {
  if (!rawName) return [];
  const ctx: Ctx = { aliases, known };
  let s = asciiPunct(rawName);
  // "Drug: X", "Phase IIb: X", "GLP-1 receptor agonist: X" -> X
  s = s.replace(/^[^:]{1,60}:\s*(?=\S)/, "");
  s = s.replace(/\s*\band\s*\/\s*or\b\s*/gi, " or ");
  // "X or placebo" / "placebo or X" -> X
  s = s.replace(/\s+or\s+(matching\s+)?placebos?\b.*$/i, "").replace(/^placebos?\s+or\s+/i, "");
  // Doses first, so "32 mg/bupropion" or "6Mg/Ml" are not mistaken for combinations.
  s = s.replace(DOSE_RE, " ").replace(/\s+/g, " ").trim();

  const out: ProductRef[] = [];
  // "A or B", "A; B" (several interventions typed into one field, e.g.
  // "SHR-1179 ; Placebo") and comma lists name separate products.
  // A semicolon inside brackets lists parts of one regimen: "Best care (Metformin; gliclazide)".
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => `(${inner.replace(/\s*;\s*/g, " + ")})`);
  let alternatives = s.split(/\s+or\s+|\s*;\s*|\n+|,(?=\s*[A-Za-z])/i);
  // In a comma list, a trailing "and" enumerates too: "A, B and C" -> A | B | C.
  if (/,(?=\s*[A-Za-z])/.test(s)) alternatives = alternatives.flatMap((a) => a.split(/\s+and\s+/i));
  for (const alt of alternatives) {
    if (!alt.trim()) continue;
    // Descriptions that ride along in a list ("Rosuvastatin; improvement of lipid profile").
    if (alternatives.length > 1 && NON_DRUG_PART_RE.test(alt)) continue;

    // Whole-name alias ("Wegovy", "CagriSema", "VI-0521", "SR141716", "Saxenda (liraglutide)").
    const wholeSlug = slugify(meaningfulTokens(scrub(alt.replace(/[+/&]/g, " "))).join(" "));
    if (aliases.has(wholeSlug)) {
      out.push(aliases.get(wholeSlug)!);
      continue;
    }
    // Only a parenthetical, e.g. "(semaglutide)" -> use the inside.
    const outside = alt.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
    const inside = [...alt.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => m[1] ?? m[2]).join(" ");
    const resolve = (text: string) =>
      uniq(text.split(COMBO_SPLIT_RE).flatMap((part) => resolveFragment(part, ctx)));
    let comps = PLACEBO_RE.test(outside) && !/[+/&]|\s(and|plus|with)\s/i.test(outside) ? [] : resolve(outside);
    // "GLP-1 (Liraglutide)", "Formulation A (PF-07081532 ...)", "(semaglutide)" -> use the inside,
    // unless the name is a placebo ("Placebo (semaglutide)").
    if (comps.length === 0 && inside.trim() && !PLACEBO_RE.test(outside)) comps = resolve(inside);
    if (comps.length === 0) continue;
    if (comps.length === 1) {
      out.push(comps[0]);
      continue;
    }
    const sorted = [...comps].sort((a, b) => a.slug.localeCompare(b.slug));
    const combo: ProductRef = {
      slug: sorted.map((c) => c.slug).join("_"),
      name: sorted.map((c) => c.name).join(" + "),
    };
    out.push(aliases.get(combo.slug) ?? combo);
  }
  return uniq(out);
}

/**
 * Derive products for a whole trial.
 *   kept      the intervention names that named at least one product (placebos dropped)
 *   products  unique products across all names
 */
export function deriveTrialProducts(
  names: string[],
  aliases: AliasMap = builtinAliasMap(),
  known: Set<string> = new Set(),
): { kept: string[]; products: ProductRef[] } {
  const kept: string[] = [];
  const products: ProductRef[] = [];
  for (const n of names ?? []) {
    const ps = productsFromName(n, aliases, known);
    if (!ps.length) continue;
    kept.push(n);
    products.push(...ps);
  }
  return { kept: [...new Set(kept)], products: uniq(products) };
}

/** Alias target slugs (always treated as known products). */
export function aliasTargets(aliases: AliasMap): Set<string> {
  const s = new Set<string>();
  for (const p of aliases.values()) for (const part of p.slug.split("_")) s.add(part);
  return s;
}

/**
 * Build the "known products" set from a whole corpus: single products named in
 * short form (one or two words) by at least `minTrials` trials, plus alias
 * targets. Used to pull drug names out of free-text interventions.
 */
export function buildKnownSet(
  trialsNames: string[][],
  aliases: AliasMap = builtinAliasMap(),
  minTrials = 2,
): Set<string> {
  const counts = new Map<string, number>();
  for (const names of trialsNames) {
    const seen = new Set<string>();
    for (const n of names) {
      for (const p of productsFromName(n, aliases)) {
        if (p.slug.includes("_") || p.name.split(" ").length > 2 || COMMON_WORDS.has(p.slug)) continue;
        seen.add(p.slug);
      }
    }
    for (const s of seen) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const known = aliasTargets(aliases);
  for (const [s, c] of counts) if (c >= minTrials) known.add(s);
  return known;
}
