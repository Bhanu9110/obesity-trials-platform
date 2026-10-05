// Which parts of the site a guest login may open. Chosen per guest on the Admin
// page. The Admin page itself is never available to guests, whatever is chosen.
// No server-only imports: this runs in the middleware too.

export const GUEST_PAGES = [
  { key: "trials", label: "Trials", path: "/", hint: "trial list and search" },
  { key: "drugs", label: "Drugs", path: "/drugs", hint: "drug list and drug pages" },
  { key: "changes", label: "Changes", path: "/changes", hint: "what changed in the registry" },
  { key: "quality", label: "Data quality", path: "/quality", hint: "quality scores and issues" },
  { key: "quality_export", label: "Data quality CSV download", path: null, hint: "download the quality list" },
] as const;

export type GuestPage = (typeof GUEST_PAGES)[number]["key"];

export const DEFAULT_GUEST_PAGES: GuestPage[] = ["trials", "drugs", "changes"];
const KEYS = GUEST_PAGES.map((p) => p.key) as readonly string[];

/** Valid, de-duplicated page list; the CSV download only comes with Data quality. */
export function cleanPages(input: unknown): GuestPage[] {
  const list = Array.isArray(input) ? input.map(String).filter((k) => KEYS.includes(k)) : [];
  const set = new Set(list as GuestPage[]);
  if (!set.has("quality")) set.delete("quality_export");
  return GUEST_PAGES.map((p) => p.key).filter((k) => set.has(k));
}

/**
 * What a request needs: a page permission, "always" (sign-in, trial records,
 * other pages), or "never" (Admin and its APIs, and any API not listed here).
 */
export function requiredPage(pathname: string): GuestPage | "always" | "never" {
  const under = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (["/admin", "/api/sync", "/api/failures", "/api/access", "/api/users", "/api/guests"].some(under)) return "never";
  if (["/login", "/api/auth", "/api/activity", "/api/health", "/trials"].some(under)) return "always";
  if (pathname === "/" || under("/api/trials") || under("/api/filters")) return "trials";
  if (under("/drugs") || under("/api/products")) return "drugs";
  if (under("/changes")) return "changes";
  if (under("/api/quality/export")) return "quality_export";
  if (under("/quality")) return "quality";
  return pathname.startsWith("/api/") ? "never" : "always";
}

export function guestMayOpen(pages: readonly string[], pathname: string): boolean {
  const need = requiredPage(pathname);
  if (need === "never") return false;
  if (need === "always") return true;
  if (need === "quality_export") return pages.includes("quality") && pages.includes("quality_export");
  return pages.includes(need);
}

/** Where a guest lands: the first page they may open. */
export function firstPagePath(pages: readonly string[]): string {
  return GUEST_PAGES.find((p) => p.path && pages.includes(p.key))?.path ?? "/login";
}
