import cron from "node-cron";
import { config } from "./config.js";
import {
  runSync,
  trialCount,
  daysSinceLastSuccessfulSync,
  upgradeIfNeeded,
  retryFailures,
  type SyncResult,
} from "./sync.js";
import { enrichProducts } from "./enrich.js";

function log(msg: string, obj?: unknown) {
  const ts = new Date().toISOString();
  console.log(`[scheduler ${ts}] ${msg}${obj ? " " + JSON.stringify(obj) : ""}`);
}

let running = false;

// Cap a catch-up window so a very long outage doesn't hammer the API; beyond
// this, a manual `npm run backfill` is the right tool.
const MAX_CATCHUP_DAYS = 30;

/** Run one sync, guarding against overlap. `days` overrides the incremental window. */
async function runOnce(full: boolean, days?: number): Promise<SyncResult | null> {
  if (running) {
    log("previous sync still running; skipping this tick");
    return null;
  }
  running = true;
  try {
    const result = await runSync(full, days);
    log(`${full ? "backfill" : "incremental"} sync complete`, result);
    return result;
  } catch (err) {
    log("sync failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    running = false;
  }
}

/**
 * Incremental sync sized to cover every day since the last successful run, so
 * days missed while the machine was off are caught up. Falls back to the
 * configured window when there is no prior run.
 */
async function runCatchUp(reason: string): Promise<void> {
  const gap = await daysSinceLastSuccessfulSync();
  const days =
    gap == null
      ? config.ctgov.incrementalDays
      : Math.min(Math.max(gap, config.ctgov.incrementalDays), MAX_CATCHUP_DAYS);
  log(`${reason}: incremental sync covering last ${days} day(s)`);
  await runOnce(false, days);
  // Then the retry queue: failed records whose next attempt is due.
  if (running) return;
  running = true;
  try {
    const r = await retryFailures();
    if (r.due) log("retry queue", r);
  } catch (err) {
    log("retry queue failed", { error: err instanceof Error ? err.message : String(err) });
  }
  // Then the automatic drug profiles (blank fields only; never the hand-entered ones).
  try {
    log("drug profiles auto-filled", await enrichProducts({ log }));
  } catch (err) {
    log("drug-profile auto-fill failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

async function main() {
  const { cron: expr, tz, backfillOnStartIfEmpty } = config.scheduler;

  if (!cron.validate(expr)) {
    throw new Error(`Invalid SYNC_CRON expression: "${expr}"`);
  }

  // Startup behaviour:
  //   - bring the database up to date: full backfill if empty or if trials lack
  //     lineage (upgrade from v1), re-parse raw records from an older parser,
  //     rebuild product links if the matching rules changed;
  //   - then a catch-up incremental sync RIGHT NOW, covering any days missed while
  //     the machine/container was off (reliable on a laptop that isn't on at midnight).
  const count = await trialCount();
  if (count === 0 && !backfillOnStartIfEmpty) {
    log("database empty and backfill-on-start disabled — skipping");
  } else {
    let didFull = false;
    running = true;
    try {
      didFull = await upgradeIfNeeded(log);
    } catch (err) {
      log("startup upgrade failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
    if (!didFull) {
      log(`database has ${await trialCount()} trials — running catch-up sync on startup`);
      await runCatchUp("startup catch-up");
    }
  }

  // Daily scheduled run (for days the machine happens to be on at this time).
  const options = tz ? { timezone: tz } : undefined;
  cron.schedule(
    expr,
    () => {
      log("cron tick");
      void runCatchUp("scheduled");
    },
    options as any,
  );

  log("scheduler started", {
    cron: expr,
    timezone: tz || "(host local time)",
    condition: config.ctgov.condition,
    startDateFrom: config.ctgov.startDateFrom,
    note: "also syncs on every startup",
  });

  // Keep the process alive.
  process.stdin.resume();
}

main().catch((err) => {
  console.error("Scheduler fatal:", err);
  process.exit(1);
});
