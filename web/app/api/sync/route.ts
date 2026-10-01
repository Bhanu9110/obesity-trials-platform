import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { query } from "@/lib/db";
import { dashboardCounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET: pipeline health for the admin dashboard — counts, recent runs, open failures. */
export async function GET() {
  try {
    const [runs, failures, counts, lastSync] = await Promise.all([
      query(
        `SELECT id, run_at, status, trials_fetched, trials_upserted, trials_failed,
                api_pages_consumed, duration_ms
           FROM sync_runs ORDER BY run_at DESC LIMIT 10`,
      ),
      query(
        `SELECT nct_id, failure_type, error_msg, retry_count, last_attempted
           FROM sync_failures WHERE resolved = false ORDER BY last_attempted DESC LIMIT 25`,
      ),
      dashboardCounts(),
      query(`SELECT max(run_at) AS last_run FROM sync_runs WHERE status IN ('success','partial')`),
    ]);
    return NextResponse.json({
      runs,
      failures,
      counts,
      lastSuccessfulSync: (lastSync[0] as any)?.last_run ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 },
    );
  }
}

/**
 * POST: trigger a manual sync (admin only). Requires the x-admin-token header to
 * match ADMIN_TOKEN. Spawns the sync workspace CLI detached so the request
 * returns immediately; progress is visible via GET (sync_runs).
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-admin-token");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const full = req.nextUrl.searchParams.get("full") === "true";
  try {
    const syncDir = path.resolve(process.cwd(), "..", "sync");
    const child = spawn("npm", ["run", full ? "sync:full" : "sync"], {
      cwd: syncDir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    return NextResponse.json({ started: true, mode: full ? "full" : "incremental" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to start sync" },
      { status: 500 },
    );
  }
}
