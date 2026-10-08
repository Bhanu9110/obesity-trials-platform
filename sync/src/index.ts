#!/usr/bin/env node
import { config } from "./config.js";
import {
  runSync,
  rebuildProducts,
  daysSinceLastSuccessfulSync,
  upgradeIfNeeded,
  reparseFromRaw,
  refreshQuality,
  retryFailures,
  reclassifyAll,
} from "./sync.js";
import { dismissFailure, failureCounts, requeueFailure } from "./failures.js";
import { checkHealth, formatHealth } from "./health.js";
import { enrichProducts } from "./enrich.js";
import { closePool, pool } from "./db.js";

function log(msg: string, obj?: unknown) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}${obj ? " " + JSON.stringify(obj) : ""}`);
}

const USAGE = `Commands:
  sync [--full]        incremental sync now (or a full re-download)
  backfill             full re-download of every trial
  daily                what the daily job does: upgrades if needed, catch-up sync, retry queue
  retry                retry failed records that are due (re-fetched by NCT ID)
  failures             list the retry queue and the dead-letter queue
  requeue <NCT…>       put dead-letter records back in the retry queue
  dismiss <NCT…>       ignore failed records
  classify             re-classify stored trials (primary / comorbidity / weight_related / unrelated)
  reparse [--all]      re-map stored raw records with the current parser (no download)
  quality              recompute the data-quality checks
  rebuild-products     re-derive drugs (after editing product_aliases)
  enrich-products      auto-fill blank drug-profile fields (trials + ChEMBL + openFDA)
                       [--no-external] trial data only; [slug…] only these drugs
  health               pipeline health checks (exit code 1 when a check fails)`;

async function main() {
  const cmd = process.argv[2] ?? "sync";
  const args = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const full = process.argv.includes("--full");

  switch (cmd) {
    case "sync":
    case "backfill": {
      const isFull = cmd === "backfill" || full;
      log(`Starting ${isFull ? "FULL" : "incremental"} sync`, { condition: config.ctgov.condition });
      const result = await runSync(isFull);
      log("Sync complete", result);
      break;
    }
    case "daily": {
      // One-shot version of what the scheduler does (used by the GitHub Actions
      // daily job): bring the database up to date (backfill / lineage / re-parse /
      // re-classify / product rebuild as needed), then an incremental sync covering
      // every day since the last successful run (max 30), then the retry queue.
      if (!(await upgradeIfNeeded(log))) {
        const gap = await daysSinceLastSuccessfulSync();
        const days = Math.min(Math.max(gap ?? config.ctgov.incrementalDays, config.ctgov.incrementalDays), 30);
        log(`Incremental sync covering last ${days} day(s)`);
        const result = await runSync(false, days);
        log("Sync complete", result);
        if (result.failed > 0 && result.upserted + result.unchanged === 0) process.exitCode = 1;
      }
      const retry = await retryFailures();
      if (retry.due) log("Retry queue", retry);
      log("Queue", await failureCounts());
      break;
    }
    case "retry": {
      log("Retry queue", await retryFailures());
      log("Queue", await failureCounts());
      break;
    }
    case "failures": {
      const r = await pool.query(
        `SELECT nct_id, status, failure_type, retry_count + 1 AS attempts,
                to_char(last_attempted, 'YYYY-MM-DD HH24:MI') AS last_attempt,
                to_char(next_attempt_at, 'YYYY-MM-DD HH24:MI') AS next_attempt, left(error_msg, 120) AS error
           FROM sync_failures WHERE status IN ('pending', 'dead') ORDER BY status, last_attempted DESC`,
      );
      if (!r.rowCount) log("No open failures — the retry and dead-letter queues are empty.");
      else console.table(r.rows);
      break;
    }
    case "requeue":
    case "dismiss": {
      if (!args.length) throw new Error(`Usage: ${cmd} NCT01234567 [NCT…]`);
      for (const id of args) {
        const ok = cmd === "requeue" ? await requeueFailure(id.toUpperCase()) : await dismissFailure(id.toUpperCase());
        log(`${id}: ${ok ? (cmd === "requeue" ? "back in the retry queue (due now)" : "dismissed") : "no open failure"}`);
      }
      break;
    }
    case "classify": {
      log("Classification", await reclassifyAll());
      break;
    }
    case "reparse": {
      // Re-map stored raw records with the current parser (no download).
      // Default: only records parsed by an older parser; --all re-parses everything.
      const r = await reparseFromRaw({ all: process.argv.includes("--all") });
      log("Re-parse complete", r);
      break;
    }
    case "quality": {
      log("Data-quality checks refreshed", { trials: await refreshQuality() });
      break;
    }
    case "rebuild-products": {
      // Re-derive drug products for every trial (after editing product_aliases,
      // or when the matching rules change). Manual product info is preserved.
      const r = await rebuildProducts();
      log("Products rebuilt", r);
      break;
    }
    case "enrich-products": {
      // Automatic drug profiles: fills products.auto_info (hand-entered fields are
      // never touched). Looks up a limited number of drugs in ChEMBL / openFDA per run.
      const r = await enrichProducts({
        log,
        external: process.argv.includes("--no-external") ? false : undefined,
        only: args.length ? args : undefined,
      });
      log("Drug profiles auto-filled", r);
      if (r.sourcesDown.length) console.warn(`::warning::Some drug references were unavailable this run: ${r.sourcesDown.join(" | ")}`);
      break;
    }
    case "health": {
      const report = await checkHealth();
      console.log(formatHealth(report));
      if (report.status === "fail") process.exitCode = 1;
      break;
    }
    default:
      console.error(`Unknown command "${cmd}".\n${USAGE}`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
