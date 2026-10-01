#!/usr/bin/env node
import { config } from "./config.js";
import { runSync, pruneNonObesityIndication, rebuildProducts } from "./sync.js";
import { closePool } from "./db.js";

function log(msg: string, obj?: unknown) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}${obj ? " " + JSON.stringify(obj) : ""}`);
}

async function main() {
  const cmd = process.argv[2] ?? "sync";
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
    case "rebuild-products": {
      // Re-derive drug products for every trial (after editing product_aliases,
      // or when the matching rules change). Manual product info is preserved.
      const r = await rebuildProducts();
      log("Products rebuilt", r);
      break;
    }
    case "prune-nonobesity": {
      const apply = process.argv.includes("--apply");
      const result = await pruneNonObesityIndication({ apply });
      log(
        apply ? "Obesity-indication prune APPLIED (non-obesity trials deleted)" : "Obesity-indication prune DRY-RUN (nothing removed)",
        {
          scanned: result.scanned,
          keptObesity: result.keep,
          removedNonObesity: result.remove,
          skippedNoConditionData: result.skippedNoConditions,
        },
      );
      for (const s of result.sample) log(`  remove ${s.nct_id}`, { conditions: s.conditions });
      if (!apply && result.remove) log("Re-run with --apply to delete these.");
      break;
    }
    default:
      console.error(
        `Unknown command "${cmd}". Use: sync [--full] | backfill | rebuild-products | prune-nonobesity [--apply]`,
      );
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
