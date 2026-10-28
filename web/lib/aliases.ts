// Alias (code name) display.
//
// People type a code with or without a hyphen or space, so every code name is shown in all three
// spellings: "VT355" -> "VT355, VT-355, VT 355". (Search already ignores spacing and hyphens.)
// Junk spellings that the registries glue together ("HRS9531PLACEBO", "BGM0504MULTIDOSE",
// "ecnoglutidedosage") are left out.

const squash = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Letters, then digits (and anything after): "VT-355", "NNC0174-0833", "BI 456906", "LY3437943". */
const CODE_RE = /^([A-Za-z]{1,6})[\s-]?(\d{2,}[A-Za-z0-9]*(?:-\d+[A-Za-z]?)?)$/;

/** The three spellings of a code name, the given spelling first. Not a code -> just the name. */
export function codeVariants(name: string): string[] {
  const n = name.trim();
  const m = CODE_RE.exec(n);
  if (!m || /\s.*\s/.test(n)) return [n];
  const [, pre, rest] = m;
  return [...new Set([n, `${pre}${rest}`, `${pre}-${rest}`, `${pre} ${rest}`])];
}

/** Split a stored list ("A, B; C") into names. */
export const splitNames = (s: string | null | undefined) => (s ?? "").split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);

/**
 * Clean a list of other names: drop exact repeats (ignoring case, spacing and hyphens), the drug's
 * own name, and glued-together junk — a name with no space or hyphen that contains another of its
 * names plus extra letters ("HRS9531PLACEBO" next to "HRS9531").
 */
export function cleanNames(names: string[], ownName = ""): string[] {
  const own = squash(ownName);
  const all = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const keys = [own, ...all.map(squash)].filter((k) => k.length >= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of all) {
    const k = squash(n);
    if (!k || k === own || seen.has(k)) continue;
    if (/^[A-Za-z0-9]+$/.test(n) && keys.some((o) => o !== k && k.includes(o))) continue;
    if (/^\(?s\)?-?$|^placebo$|^active imp$/i.test(n)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** Aliases for display: cleaned, each code name in its three spellings. */
export function aliasDisplay(value: string | null | undefined, ownName = ""): string {
  return cleanNames(splitNames(value), ownName).flatMap(codeVariants).join(", ");
}
