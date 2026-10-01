import cron from "node-cron";
import { config } from "./config.js";
import {
  runSync,
  trialCount,
  daysSinceLastSuccessfulSync,
  productsNeedRebuild,
  rebuildProducts,
  type SyncResult,
} from "./sync.js";

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
}

async function main() {
  const { cron: expr, tz, backfillOnStartIfEmpty } = config.scheduler;

  if (!cron.validate(expr)) {
    throw new Error(`Invalid SYNC_CRON expression: "${expr}"`);
  }

  // Startup behaviour:
  //   - empty DB  -> full backfill of the whole corpus (year 2000+)
  //   - non-empty -> a catch-up incremental sync RIGHT NOW, covering any days
  //                  missed while the machine/container was off. This is what
  //                  makes updates reliable on a laptop that isn't on at midnight.
  // Drug products: build them after an upgrade from the old schema, or when the
  // product-matching rules have changed. Manual product info is preserved.
  if ((await trialCount()) > 0 && (await productsNeedRebuild())) {
    log("building drug products from trial interventions");
    try {
      log("products built", await rebuildProducts());
    } catch (err) {
      log("product build failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const count = await trialCount();
  if (count === 0) {
    if (backfillOnStartIfEmpty) {
      log("database empty — running initial full backfill (this can take a while)");
      await runOnce(true);
    } else {
      log("database empty and backfill-on-start disabled — skipping");
    }
  } else {
    log(`database has ${count} trials — running catch-up sync on startup`);
    await runCatchUp("startup catch-up");
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
