// Drug classes for search: typing a class ("GLP-1 agonists", "amylin analogues", "SGLT2 inhibitors")
// lists every drug in that class, on the Drugs page, in the Trials explorer and in the top search.
//
// A drug's targets are read from its profile: sub-class first (the most precise), else mechanism,
// else therapy class; for a drug with no profile, from its INN stem (-glutide, -lintide, -gliflozin …).
// Multi-target drugs and combinations are included and labelled: "GLP-1 only", "Dual: GIP + GLP-1",
// "Triple: …", "Combination: …". Pure functions (no database), used on the server and in the browser.

export interface ClassDrug {
  name: string;
  inn?: string | null;
  drug_class?: string | null;
  therapy_subclass?: string | null;
  moa?: string | null;
}

/** Receptor targets counted for single / dual / triple. */
const TARGETS = [
  { key: "glp1", label: "GLP-1", re: /\bglp-?\s?1(?![0-9])|\bglp1r?\b/ },
  { key: "gip", label: "GIP", re: /\bgipr?\b/ },
  { key: "glucagon", label: "glucagon", re: /glucagon|\bgcgr?\b/ },
  { key: "amylin", label: "amylin", re: /amylin|calcitonin|\bdacra\b|\bsara\b/ },
  { key: "glp2", label: "GLP-2", re: /\bglp-?\s?2\b/ },
  { key: "npy2", label: "NPY2", re: /\bnpy-?\s?y?2\b|\bpyy\b/ },
] as const;
type TargetKey = (typeof TARGETS)[number]["key"];

/** INN stems, used only when a drug has no class information at all. */
const STEMS: [RegExp, TargetKey[], string?][] = [
  [/trutide$/, ["glp1", "gip", "glucagon"]],
  [/dutide$/, ["glp1", "glucagon"]],
  [/glutide$|glipron$/, ["glp1"]],
  [/lintide$|^pramlintide$/, ["amylin"]],
  [/gliflozin$/, [], "sglt2"],
  [/gliptin$/, [], "dpp4"],
  [/nabant$/, [], "cb1"],
  [/grumab$|grobart$/, [], "muscle"],
  [/melagon$|melanotide$/, [], "mc4r"],
];

export interface DrugClassDef {
  key: string;
  label: string;
  /** what people type, normalised (see normQuery) */
  words: string[];
  /** extra text test (class / sub-class / mechanism / name), for non-receptor classes */
  re?: RegExp;
  /** receptor targets: the drug must act on at least one (as an agonist) */
  targets?: TargetKey[];
  /** multi-target classes: at least this many agonist targets */
  minTargets?: number;
}

export const DRUG_CLASSES: DrugClassDef[] = [
  { key: "glp1", label: "GLP-1 receptor agonists", targets: ["glp1"],
    words: ["glp1", "glp1 agonist", "glp1 receptor agonist", "glp1 analogue", "glp1 ra", "glp1ra", "glp1 peptide", "oral glp1", "glp1 receptor"] },
  { key: "gip", label: "GIP receptor agonists", targets: ["gip"], words: ["gip", "gip agonist", "gip receptor agonist", "gipr agonist", "gip analogue"] },
  { key: "gipr_antag", label: "GIP receptor antagonists", words: ["gip antagonist", "gipr antagonist", "gip receptor antagonist", "gip blocker"],
    re: /gipr? (receptor )?antagonist|blocks the gip/ },
  { key: "glucagon", label: "Glucagon receptor agonists", targets: ["glucagon"], words: ["glucagon", "glucagon agonist", "glucagon receptor agonist", "gcg agonist", "gcgr agonist"] },
  { key: "amylin", label: "Amylin analogues / amylin receptor agonists", targets: ["amylin"],
    words: ["amylin", "amylin analogue", "amylin agonist", "amylin receptor agonist", "amylin based", "amylin based therapy", "dacra", "sara", "calcitonin receptor agonist"] },
  { key: "incretin", label: "Incretin-based therapies (GLP-1, GIP, glucagon)", targets: ["glp1", "gip", "glucagon"],
    words: ["incretin", "incretin based", "incretin based therapy", "incretin therapy", "incretin mimetic", "incretin agonist"] },
  { key: "multi", label: "Dual and triple agonists", minTargets: 2,
    words: ["dual agonist", "triple agonist", "co agonist", "coagonist", "multi agonist", "multiagonist", "dual", "triple", "unimolecular"] },
  { key: "cb1", label: "CB1 receptor blockers",
    re: /(\bcb-?1\b|cannabinoid[- ]?1)[^|]*(antagonist|inverse|block|antibody)|(antagonist|inverse agonist|blocker)[^|]*\bcb-?1\b|nabant\b/,
    words: ["cb1", "cb1 antagonist", "cb1 blocker", "cb1 inverse agonist", "cannabinoid antagonist", "cannabinoid 1 antagonist"] },
  { key: "sglt2", label: "SGLT2 inhibitors", re: /sglt|gliflozin/, words: ["sglt2", "sglt", "sglt2 inhibitor", "sglt inhibitor", "gliflozin"] },
  { key: "dpp4", label: "DPP-4 inhibitors", re: /dpp-?\s?4|gliptin/, words: ["dpp4", "dpp4 inhibitor", "gliptin"] },
  { key: "mc4r", label: "MC4R / melanocortin agonists", re: /\bmc4r?\b|melanocortin|melagon|melanotide/,
    words: ["mc4r", "mc4", "mc4r agonist", "melanocortin", "melanocortin agonist"] },
  { key: "muscle", label: "Muscle-preserving (myostatin / activin pathway)", re: /myostatin|activin|muscle|grumab|grobart|gdf-?8|inhbe|alk-?7/,
    words: ["myostatin", "activin", "muscle", "muscle preserving", "muscle sparing", "myostatin inhibitor", "activin inhibitor", "anti myostatin"] },
  { key: "lipase", label: "Lipase inhibitors", re: /lipase|orlistat|cetilistat/, words: ["lipase", "lipase inhibitor"] },
  { key: "metap2", label: "MetAP2 inhibitors", re: /metap-?2|methionine aminopeptidase/, words: ["metap2", "metap2 inhibitor"] },
  { key: "fgf21", label: "FGF21 pathway", re: /fgf-?21|fgfr1|klotho/, words: ["fgf21", "fgf21 analogue", "fgf21 agonist"] },
  { key: "leptin", label: "Leptin analogues / leptin pathway", re: /leptin/, words: ["leptin", "leptin analogue", "leptin agonist"] },
  { key: "5ht2c", label: "5-HT2C agonists", re: /5-?ht2c/, words: ["5ht2c", "5ht2c agonist", "serotonin 2c agonist"] },
  { key: "sympathomimetic", label: "Sympathomimetics / stimulants", re: /sympathomimetic|amphetamine|stimulant|phentermine|diethylpropion/,
    words: ["sympathomimetic", "stimulant", "amphetamine"] },
  { key: "dgat", label: "DGAT inhibitors", re: /\bdgat/, words: ["dgat", "dgat1", "dgat2", "dgat inhibitor"] },
];

/** Normalise what was typed: "GLP-1 Receptor Agonists" -> "glp1 agonist", "Amylin analogs" -> "amylin analogue". */
export function normQuery(q: string): string {
  return q.normalize("NFKD").toLowerCase()
    .replace(/([a-z])[\s-]+(\d)/g, "$1$2")                      // glp-1 / glp 1 -> glp1
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\breceptors?\b/g, "receptor")
    .replace(/\b(analogs?|analogues)\b/g, "analogue")
    .replace(/\bagonists\b/g, "agonist").replace(/\bantagonists\b/g, "antagonist")
    .replace(/\binhibitors\b/g, "inhibitor").replace(/\bblockers\b/g, "blocker")
    .replace(/\b(therapies)\b/g, "therapy").replace(/\b(drugs|medications|medicines|class|classes)\b/g, "")
    .replace(/\bras?\b/g, "ra")
    .replace(/\s+/g, " ").trim();
}

/** The class a search term names, or null ("glp-1 agonists" -> GLP-1 receptor agonists). */
export function classForQuery(q: string): DrugClassDef | null {
  const n = normQuery(q);
  if (n.length < 2) return null;
  const words = (c: DrugClassDef) => c.words.map(normQuery);
  return DRUG_CLASSES.find((c) => words(c).includes(n))
    // "glp1 receptor agonist" with "receptor" dropped, "glp1 agonist" with "agonist" dropped
    ?? DRUG_CLASSES.find((c) => words(c).includes(n.replace(/\breceptor\b/g, "").replace(/\s+/g, " ").trim()))
    ?? null;
}

export interface DrugTargets {
  /** receptor targets it activates */
  agonist: Set<TargetKey>;
  /** receptor targets it blocks (e.g. GIPR for maridebart cafraglutide) */
  antagonist: Set<TargetKey>;
  /** all text read (lower case), for the non-receptor classes */
  text: string;
  /** the source of the targets: "subclass" | "moa" | "class" | "stem" | "parts" */
  from: string;
  /** stem classes for drugs with no profile (sglt2, dpp4 …) */
  stemClass: string | null;
  combination: boolean;
}

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Targets of one drug (without looking at combination parts). */
function ownTargets(d: ClassDrug): DrugTargets {
  const sub = lower(d.therapy_subclass), moa = lower(d.moa), cls = lower(d.drug_class);
  const src = sub ? "subclass" : moa ? "moa" : cls ? "class" : "";
  const text = [sub, moa, cls, lower(d.name), lower(d.inn)].join(" | ");
  const agonist = new Set<TargetKey>();
  const antagonist = new Set<TargetKey>();
  const main = sub || moa || cls;
  // Not a receptor agonist: blockers, and drugs that only raise the body's own hormone ("increases GLP-1 secretion").
  const BLOCK = /antagonist|inverse agonist|blocker|blocks|inhibit|antibody(?!.*agonist)/;
  const INDIRECT = /secret|release|secretagog|stimulat|enhanc|non-?\s?glp|endogenous/;
  // Read segment by segment so "GIPR antagonist / GLP-1 receptor agonist" counts GLP-1 only.
  for (const seg of main.split(/\s*[/,;+]\s*/)) {
    if (INDIRECT.test(seg)) continue;
    for (const t of TARGETS) if (t.re.test(seg)) (BLOCK.test(seg) ? antagonist : agonist).add(t.key);
  }
  // A whole phrase like "Dual GLP-1 and GIP receptor agonist" in one segment.
  if (!BLOCK.test(main) && !INDIRECT.test(main)) for (const t of TARGETS) if (t.re.test(main)) agonist.add(t.key);
  // Category entries named as a blocker ("GLP-1 Receptor Antagonist") are not agonists.
  if (/antagonist|non-?\s?glp/.test(lower(d.name))) agonist.clear();
  let stemClass: string | null = null;
  let from = src;
  if (!main) {
    const names = [lower(d.inn), lower(d.name)].filter(Boolean);
    for (const [re, targets, cls2] of STEMS) {
      if (names.some((n) => n.split(/\s*\+\s*/).some((part) => re.test(part.trim())))) {
        targets.forEach((t) => agonist.add(t));
        stemClass ??= cls2 ?? null;
        from = "stem";
      }
    }
  }
  return { agonist, antagonist, text, from, stemClass, combination: / \+ /.test(d.name) || /\+/.test(sub) };
}

/**
 * Targets of every drug, with combinations ("Liraglutide + Orlistat") also taking the targets of
 * their parts when the parts are drugs in the list.
 */
export function targetsFor<T extends ClassDrug>(drugs: T[]): Map<T, DrugTargets> {
  const own = new Map<T, DrugTargets>(drugs.map((d) => [d, ownTargets(d)]));
  const byName = new Map(drugs.map((d) => [lower(d.name).replace(/[^a-z0-9]/g, ""), d]));
  for (const d of drugs) {
    if (!/ \+ /.test(d.name)) continue;
    const t = own.get(d)!;
    for (const part of d.name.split(/\s*\+\s*/)) {
      const p = byName.get(lower(part).replace(/[^a-z0-9]/g, ""));
      if (!p || p === d) continue;
      const pt = own.get(p)!;
      pt.agonist.forEach((x) => t.agonist.add(x));
      t.text += " | " + pt.text;
      t.stemClass ??= pt.stemClass;
      t.combination = true;
      if (!t.from) t.from = "parts";
    }
  }
  return own;
}

/** Is this drug in the class? */
export function inClass(c: DrugClassDef, t: DrugTargets): boolean {
  if (c.minTargets) return !t.combination && t.agonist.size >= c.minTargets;
  if (c.targets && c.targets.some((k) => t.agonist.has(k))) return true;
  if (c.key === "incretin" && /incretin/.test(t.text)) return true;
  if (c.re && c.re.test(t.text)) return true;
  return t.stemClass === c.key;
}

/** "GLP-1 only", "Dual: GIP + GLP-1", "Triple: GLP-1 + GIP + glucagon", "Combination: amylin + GLP-1". */
export function targetLabel(t: DrugTargets): { kind: "single" | "dual" | "triple" | "multi" | "combination" | "other"; label: string } {
  const names = TARGETS.filter((x) => t.agonist.has(x.key)).map((x) => x.label);
  const blocks = TARGETS.filter((x) => t.antagonist.has(x.key) && !t.agonist.has(x.key)).map((x) => `${x.label}R antagonist`);
  if (blocks.length && names.length && !t.combination) return { kind: "dual", label: `${names.join(" + ")} agonist + ${blocks.join(" + ")}` };
  if (t.combination) return { kind: "combination", label: names.length ? `Combination: ${names.join(" + ")}` : "Combination" };
  if (names.length === 1) return { kind: "single", label: `${names[0]} only` };
  if (names.length === 2) return { kind: "dual", label: `Dual: ${names.join(" + ")}` };
  if (names.length === 3) return { kind: "triple", label: `Triple: ${names.join(" + ")}` };
  if (names.length > 3) return { kind: "multi", label: `Multi: ${names.join(" + ")}` };
  return { kind: "other", label: "" };
}

export const KIND_ORDER = { single: 0, dual: 1, triple: 2, multi: 3, combination: 4, other: 5 } as const;

/** The drugs in a class, each with its single / dual / triple / combination label. */
export function classMembers<T extends ClassDrug>(targets: Map<T, DrugTargets>, c: DrugClassDef): Map<T, ReturnType<typeof targetLabel>> {
  const out = new Map<T, ReturnType<typeof targetLabel>>();
  for (const [d, t] of targets) if (inClass(c, t)) out.set(d, targetLabel(t));
  return out;
}

/** "42 drugs: 20 single-target, 12 dual, 6 triple, 4 combinations". */
export function classSummary(labels: Iterable<ReturnType<typeof targetLabel>>): string {
  const n = { single: 0, dual: 0, triple: 0, multi: 0, combination: 0, other: 0 };
  for (const l of labels) n[l.kind]++;
  const parts = [
    n.single && `${n.single} single-target`, n.dual && `${n.dual} dual`, n.triple && `${n.triple} triple`,
    n.multi && `${n.multi} multi-target`, n.combination && `${n.combination} combination${n.combination === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
