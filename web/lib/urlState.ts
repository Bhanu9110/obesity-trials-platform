// Keep a list page's filters in its address (?q=…&stage=…), so opening a drug and coming back
// — with the browser's Back button or the "All drugs" link — shows the same filtered list.
// Uses history.replaceState (no reload, no new history entry per keystroke).

const lastKey = (path: string) => `ot:last-url:${path}`;

/** Merge these values into the current address; empty / default values are removed. */
export function setUrlParams(values: Record<string, string | number | boolean | null | undefined>) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === "" || v === false) sp.delete(k);
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  rememberListUrl();
}

/** Remember the current list address (with its filters) for the "← All drugs / All trials" links. */
export function rememberListUrl() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(lastKey(window.location.pathname), window.location.pathname + window.location.search); }
  catch { /* storage blocked: the browser's Back button still works */ }
}

/** The list address last used in this tab, with its filters ("/drugs?q=GLP-1&stage=p2"). */
export function lastListUrl(path: string): string {
  try { return window.sessionStorage.getItem(lastKey(path)) || path; } catch { return path; }
}

/** First value of a search param from the page's props. */
export const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The filters to start from: the address the browser shows now (after Back, Next.js may re-use the
 * page it rendered before the filters were added), else what the server read from the request.
 */
export function startParams(fromServer: Record<string, string> = {}): Record<string, string> {
  if (typeof window === "undefined") return fromServer;
  return { ...fromServer, ...Object.fromEntries(new URLSearchParams(window.location.search)) };
}
