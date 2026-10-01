import { config } from "./config.js";

// Raw shape (subset) of a CT.gov v2 study record. Kept loose on purpose: the
// mapper is defensive and works with both full and `fields`-limited records.
export type RawStudy = Record<string, any>;

export interface StudiesPage {
  studies: RawStudy[];
  nextPageToken?: string;
  totalCount?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Set to false for the rest of the process if CT.gov rejects the `fields` list.
let useFields = true;

/**
 * Format a Date as YYYY-MM-DD (CT.gov date-range format).
 */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface FetchOptions {
  /** null => full backfill (no lastUpdate window). number => last N days. */
  incrementalDays: number | null;
  /** Lower bound on StartDate (YYYY-MM-DD), e.g. "2000-01-01". null => no floor. */
  startDateFrom?: string | null;
  pageToken?: string;
  countTotal?: boolean;
}

/**
 * Fetch a single page of obesity studies from the CT.gov v2 API.
 * Retries transient failures (429/5xx/network) with exponential backoff.
 *
 * Scope is composed of an Essie advanced filter joined by AND:
 *   - AREA[StartDate]RANGE[<from>,MAX]           (corpus floor, e.g. year 2000)
 *   - AREA[LastUpdatePostDate]RANGE[<from>,<to>] (incremental window, if any)
 */
export async function fetchStudiesPage(opts: FetchOptions): Promise<StudiesPage> {
  const { baseUrl, condition, pageSize, statuses, interventionTypes } = config.ctgov;
  const url = new URL(`${baseUrl}/studies`);
  url.searchParams.set("query.cond", condition);
  if (statuses.length) {
    url.searchParams.set("filter.overallStatus", statuses.join(","));
  }
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("countTotal", String(opts.countTotal ?? false));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  const fields = config.ctgov.fields;
  if (useFields && fields.length) url.searchParams.set("fields", fields.join(","));

  const advanced: string[] = [];
  if (opts.startDateFrom) {
    advanced.push(`AREA[StartDate]RANGE[${opts.startDateFrom},MAX]`);
  }
  if (opts.incrementalDays != null) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - opts.incrementalDays);
    advanced.push(`AREA[LastUpdatePostDate]RANGE[${ymd(from)},${ymd(to)}]`);
  }
  // Keep only trials that contain at least one of the configured intervention
  // types (e.g. DRUG) — this is what filters out exercise/behavioral/device-only
  // studies. Multiple types are OR'd together.
  if (interventionTypes.length) {
    const clause = interventionTypes
      .map((t) => `AREA[InterventionType]${t}`)
      .join(" OR ");
    advanced.push(interventionTypes.length > 1 ? `(${clause})` : clause);
  }
  if (advanced.length) {
    url.searchParams.set("filter.advanced", advanced.join(" AND "));
  }

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= config.ctgov.maxRetries) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Retryable HTTP ${res.status}`);
      }
      if (res.status === 400 && url.searchParams.has("fields")) {
        // The API did not accept the field list: retry with full records.
        console.warn(`[ctgov] fields list rejected (${(await res.text()).slice(0, 200)}); falling back to full records`);
        useFields = false;
        url.searchParams.delete("fields");
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as any;
      return {
        studies: body.studies ?? [],
        nextPageToken: body.nextPageToken,
        totalCount: body.totalCount,
      };
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt > config.ctgov.maxRetries) break;
      const backoff = Math.min(500 * 2 ** attempt, 8000);
      await sleep(backoff);
    }
  }
  throw new Error(
    `CT.gov fetch failed after ${config.ctgov.maxRetries} retries: ${String(lastErr)}`,
  );
}

/**
 * Async generator that yields every study across all pages for a sync run.
 * Tracks pages consumed via the onPage callback.
 */
export async function* iterateStudies(
  opts: { incrementalDays: number | null; startDateFrom?: string | null },
  onPage?: (pageIndex: number, total?: number) => void,
): AsyncGenerator<RawStudy> {
  let pageToken: string | undefined;
  let pageIndex = 0;
  do {
    const page = await fetchStudiesPage({
      incrementalDays: opts.incrementalDays,
      startDateFrom: opts.startDateFrom ?? null,
      pageToken,
      countTotal: pageIndex === 0,
    });
    onPage?.(pageIndex, page.totalCount);
    for (const study of page.studies) yield study;
    pageToken = page.nextPageToken;
    pageIndex += 1;
    if (pageToken) await sleep(config.ctgov.requestDelayMs);
  } while (pageToken);
}
