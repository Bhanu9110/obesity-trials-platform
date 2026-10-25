import type { ProductSummary } from "@/lib/types";

// Drug search on the Drugs page (cards and table): name, brand names, every code / alias name the
// database knows (products.other_names) and the profile fields. Spacing, hyphens and case are
// ignored, so "nn 9440", "NN-9440" and "nn9440" all find Monlunabant.

/** Letters and digits only, lower case: "LY-3437943" -> "ly3437943". */
export const squash = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

const splitNames = (s: string | null | undefined) => (s ?? "").split(/\s*[,;|]\s*/).map((x) => x.trim()).filter(Boolean);

export interface DrugMatch {
  hit: boolean;
  /** the alias / code / brand name that matched, when the drug's own name did not */
  via: string | null;
}

export function matchDrug(p: ProductSummary, q: string, extra: (string | null | undefined)[] = []): DrugMatch {
  const needle = q.trim().toLowerCase();
  if (!needle) return { hit: true, via: null };
  const tight = squash(needle);
  const has = (v: string | null | undefined) => {
    if (!v) return false;
    const low = v.toLowerCase();
    return low.includes(needle) || (tight.length > 0 && squash(low).includes(tight));
  };
  if (has(p.name)) return { hit: true, via: null };
  // Alias / code / brand names, one by one, so the page can say which one matched.
  const inn = p.inn && /^[A-Za-z][A-Za-z /-]*$/.test(p.inn) && p.inn.toLowerCase() !== p.name.toLowerCase() ? [p.inn] : [];
  for (const n of [...inn, ...splitNames(p.brand_names), ...splitNames(p.aliases), ...splitNames(p.other_names)]) {
    if (has(n)) return { hit: true, via: n };
  }
  if ([p.sponsor, p.drug_class, p.therapy_subclass, p.moa, ...extra].some(has)) return { hit: true, via: null };
  return { hit: false, via: null };
}
