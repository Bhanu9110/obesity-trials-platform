// Reference facts used to pre-fill the Drugs list when a drug's profile has not
// been entered by hand: development codes (aliases), brand names, originator /
// marketing company, therapy class and subclass. Only long-established facts are
// listed — anything time-sensitive (has a pipeline drug been approved yet?) is
// worked out from the trial data instead (see drug-profile.ts). Every value can
// be overridden on the drug page; a manual entry always wins.
//
// Keys are product slugs (lower-case letters and digits; combinations join their
// components with "_" in alphabetical order, e.g. "bupropion_naltrexone").

export interface DrugReference {
  aliases?: string[];   // development / code names
  brands?: string[];    // brand (trade) names
  company?: string;     // originator or main marketing company
  cls?: string;         // therapy class
  sub?: string;         // therapy subclass
  /** long-marketed, withdrawn or discontinued — never a pipeline candidate */
  status?: "marketed" | "withdrawn" | "discontinued";
}

const INCRETIN = "Incretin-based therapy";
const AMYLIN = "Amylin-based therapy";
const ANORECTIC = "Centrally acting anti-obesity agent";
const DIAB = "Antidiabetic";

export const DRUG_REFERENCE: Record<string, DrugReference> = {
  // --- GLP-1 receptor agonists ------------------------------------------------
  semaglutide: { aliases: ["NN9535", "NN9536"], brands: ["Wegovy", "Ozempic", "Rybelsus"], company: "Novo Nordisk", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "marketed" },
  liraglutide: { aliases: ["NN2211", "NN8022"], brands: ["Saxenda", "Victoza"], company: "Novo Nordisk", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "marketed" },
  dulaglutide: { aliases: ["LY2189265"], brands: ["Trulicity"], company: "Eli Lilly", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "marketed" },
  exenatide: { aliases: ["AC2993"], brands: ["Byetta", "Bydureon"], company: "AstraZeneca", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "marketed" },
  lixisenatide: { aliases: ["AVE0010"], brands: ["Adlyxin", "Lyxumia"], company: "Sanofi", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "marketed" },
  albiglutide: { brands: ["Tanzeum", "Eperzan"], company: "GSK", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "withdrawn" },
  taspoglutide: { company: "Roche / Ipsen", cls: INCRETIN, sub: "GLP-1 receptor agonist", status: "discontinued" },
  efpeglenatide: { aliases: ["HM11260C"], company: "Hanmi Pharmaceutical", cls: INCRETIN, sub: "GLP-1 receptor agonist" },
  ecnoglutide: { aliases: ["XW003"], company: "Sciwind Biosciences", cls: INCRETIN, sub: "GLP-1 receptor agonist" },
  // oral small-molecule GLP-1 RAs
  orforglipron: { aliases: ["LY3502970"], company: "Eli Lilly", cls: INCRETIN, sub: "Oral small-molecule GLP-1 receptor agonist" },
  danuglipron: { aliases: ["PF-06882961"], company: "Pfizer", cls: INCRETIN, sub: "Oral small-molecule GLP-1 receptor agonist", status: "discontinued" },
  lotiglipron: { aliases: ["PF-07081532"], company: "Pfizer", cls: INCRETIN, sub: "Oral small-molecule GLP-1 receptor agonist", status: "discontinued" },
  aleniglipron: { aliases: ["GSBR-1290"], company: "Structure Therapeutics", cls: INCRETIN, sub: "Oral small-molecule GLP-1 receptor agonist" },
  // --- multi-agonists ---------------------------------------------------------
  tirzepatide: { aliases: ["LY3298176"], brands: ["Mounjaro", "Zepbound"], company: "Eli Lilly", cls: INCRETIN, sub: "GIP/GLP-1 receptor dual agonist", status: "marketed" },
  retatrutide: { aliases: ["LY3437943"], company: "Eli Lilly", cls: INCRETIN, sub: "GIP/GLP-1/glucagon receptor triple agonist" },
  survodutide: { aliases: ["BI 456906"], company: "Boehringer Ingelheim", cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist" },
  mazdutide: { aliases: ["IBI362", "LY3305677"], company: "Innovent Biologics", cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist" },
  pemvidutide: { aliases: ["ALT-801"], company: "Altimmune", cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist" },
  cotadutide: { aliases: ["MEDI0382"], company: "AstraZeneca", cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist", status: "discontinued" },
  efinopegdutide: { aliases: ["MK-6024", "HM12525A"], company: "Merck & Co.", cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist" },
  maridebartcafraglutide: { aliases: ["AMG 133", "MariTide"], company: "Amgen", cls: INCRETIN, sub: "GLP-1 agonist / GIPR antagonist antibody-peptide conjugate" },
  hrs9531: { aliases: ["KAI-9531"], company: "Jiangsu Hengrui", cls: INCRETIN, sub: "GIP/GLP-1 receptor dual agonist" },
  // --- amylin -----------------------------------------------------------------
  cagrilintide: { aliases: ["AM833", "NNC0174-0833"], company: "Novo Nordisk", cls: AMYLIN, sub: "Long-acting amylin analogue" },
  cagrilintide_semaglutide: { aliases: ["CagriSema"], company: "Novo Nordisk", cls: AMYLIN, sub: "Amylin analogue + GLP-1 receptor agonist (fixed-dose combination)" },
  amycretin: { aliases: ["NNC0487-0111"], company: "Novo Nordisk", cls: AMYLIN, sub: "GLP-1/amylin receptor co-agonist" },
  petrelintide: { aliases: ["ZP8396"], company: "Zealand Pharma", cls: AMYLIN, sub: "Long-acting amylin analogue" },
  pramlintide: { brands: ["Symlin"], company: "AstraZeneca", cls: AMYLIN, sub: "Amylin analogue", status: "marketed" },
  // --- other anti-obesity mechanisms -----------------------------------------
  setmelanotide: { aliases: ["RM-493"], brands: ["Imcivree"], company: "Rhythm Pharmaceuticals", cls: "Melanocortin pathway", sub: "MC4R agonist", status: "marketed" },
  bimagrumab: { aliases: ["BYM338"], company: "Eli Lilly", cls: "Muscle-preserving biologic", sub: "Activin type II receptor antibody" },
  orlistat: { aliases: ["Ro 18-0647"], brands: ["Xenical", "Alli"], company: "Roche", cls: "Peripherally acting anti-obesity agent", sub: "Gastrointestinal lipase inhibitor", status: "marketed" },
  phentermine: { brands: ["Adipex-P", "Lomaira"], cls: ANORECTIC, sub: "Sympathomimetic amine (anorectic)", status: "marketed" },
  phentermine_topiramate: { aliases: ["VI-0521", "Qnexa"], brands: ["Qsymia"], company: "Vivus", cls: ANORECTIC, sub: "Sympathomimetic amine + anticonvulsant (fixed-dose combination)", status: "marketed" },
  bupropion_naltrexone: { aliases: ["NB32"], brands: ["Contrave", "Mysimba"], company: "Currax Pharmaceuticals", cls: ANORECTIC, sub: "Opioid antagonist + aminoketone antidepressant (fixed-dose combination)", status: "marketed" },
  naltrexone: { brands: ["Revia", "Vivitrol"], cls: "Neuropsychiatric", sub: "Opioid receptor antagonist", status: "marketed" },
  bupropion: { brands: ["Wellbutrin", "Zyban"], cls: "Neuropsychiatric", sub: "Aminoketone antidepressant", status: "marketed" },
  topiramate: { brands: ["Topamax"], company: "Janssen", cls: "Neuropsychiatric", sub: "Anticonvulsant", status: "marketed" },
  lorcaserin: { aliases: ["APD356"], brands: ["Belviq"], company: "Eisai", cls: ANORECTIC, sub: "Serotonin 5-HT2C receptor agonist", status: "withdrawn" },
  sibutramine: { brands: ["Meridia", "Reductil"], company: "Abbott", cls: ANORECTIC, sub: "Serotonin-norepinephrine reuptake inhibitor", status: "withdrawn" },
  rimonabant: { aliases: ["SR141716"], brands: ["Acomplia"], company: "Sanofi", cls: ANORECTIC, sub: "Cannabinoid CB1 receptor antagonist", status: "withdrawn" },
  taranabant: { aliases: ["MK-0364"], company: "Merck & Co.", cls: ANORECTIC, sub: "Cannabinoid CB1 receptor inverse agonist", status: "discontinued" },
  otenabant: { aliases: ["CP-945,598"], company: "Pfizer", cls: ANORECTIC, sub: "Cannabinoid CB1 receptor antagonist", status: "discontinued" },
  tesofensine: { aliases: ["NS2330"], company: "Saniona", cls: ANORECTIC, sub: "Triple monoamine reuptake inhibitor" },
  // --- antidiabetic background drugs -----------------------------------------
  metformin: { brands: ["Glucophage"], cls: DIAB, sub: "Biguanide", status: "marketed" },
  empagliflozin: { aliases: ["BI 10773"], brands: ["Jardiance"], company: "Boehringer Ingelheim", cls: DIAB, sub: "SGLT2 inhibitor", status: "marketed" },
  dapagliflozin: { aliases: ["BMS-512148"], brands: ["Farxiga", "Forxiga"], company: "AstraZeneca", cls: DIAB, sub: "SGLT2 inhibitor", status: "marketed" },
  canagliflozin: { brands: ["Invokana"], company: "Janssen", cls: DIAB, sub: "SGLT2 inhibitor", status: "marketed" },
  sitagliptin: { aliases: ["MK-0431"], brands: ["Januvia"], company: "Merck & Co.", cls: DIAB, sub: "DPP-4 inhibitor", status: "marketed" },
  pioglitazone: { brands: ["Actos"], company: "Takeda", cls: DIAB, sub: "Thiazolidinedione", status: "marketed" },
  insulinglargine: { brands: ["Lantus", "Toujeo"], company: "Sanofi", cls: DIAB, sub: "Basal insulin analogue", status: "marketed" },
};

/** Class / subclass from the INN stem, for drugs not listed above. */
const STEMS: { re: RegExp; cls: string; sub: string }[] = [
  { re: /trutide$/, cls: INCRETIN, sub: "GIP/GLP-1/glucagon receptor triple agonist" },
  { re: /dutide$/, cls: INCRETIN, sub: "GLP-1/glucagon receptor dual agonist" },
  { re: /tirzepatide$/, cls: INCRETIN, sub: "GIP/GLP-1 receptor dual agonist" },
  { re: /glutide$|glenatide$|exenatide$|senatide$/, cls: INCRETIN, sub: "GLP-1 receptor agonist" },
  { re: /glipron$/, cls: INCRETIN, sub: "Oral small-molecule GLP-1 receptor agonist" },
  { re: /lintide$/, cls: AMYLIN, sub: "Amylin analogue" },
  { re: /gliflozin$/, cls: DIAB, sub: "SGLT2 inhibitor" },
  { re: /gliptin$/, cls: DIAB, sub: "DPP-4 inhibitor" },
  { re: /glitazone$/, cls: DIAB, sub: "Thiazolidinedione" },
  { re: /^insulin/, cls: DIAB, sub: "Insulin" },
  { re: /statin$/, cls: "Lipid-lowering", sub: "HMG-CoA reductase inhibitor (statin)" },
  { re: /mab$/, cls: "Biologic", sub: "Monoclonal antibody" },
];

const UNDISCLOSED_CLASS: { re: RegExp; cls: string }[] = [
  { re: /glucagon|gip|glp|incretin/i, cls: INCRETIN },
  { re: /amylin/i, cls: AMYLIN },
  { re: /sglt2|dpp-4/i, cls: DIAB },
  { re: /statin|pcsk9/i, cls: "Lipid-lowering" },
  { re: /mc4r/i, cls: "Melanocortin pathway" },
];

/** Reference entry for a product (exact entry, else class/subclass from its name). */
export function drugReference(slug: string, name: string): DrugReference | null {
  if (DRUG_REFERENCE[slug]) return DRUG_REFERENCE[slug];
  if (slug.startsWith("undisclosed")) {
    const sub = name.replace(/^Undisclosed\s+/i, "");
    const cls = UNDISCLOSED_CLASS.find((c) => c.re.test(sub))?.cls;
    return { cls, sub: sub.charAt(0).toUpperCase() + sub.slice(1) };
  }
  if (slug.includes("_")) return null; // other combinations: described by their components
  const s = STEMS.find((x) => x.re.test(slug));
  return s ? { cls: s.cls, sub: s.sub } : null;
}
