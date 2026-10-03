import { NextRequest, NextResponse } from "next/server";
import { dashboardCounts, hasDrug, openFailures, recentRuns } from "@/lib/queries";
import { query } from "@/lib/db";
import { getHealth } from "@/lib/health";
import { actionsUrl, dispatchConfig, dispatchSync } from "@/lib/github";
import { currentUser, mayAdminister } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET: pipeline dashboard — health, counts, recent runs, retry / dead-letter queue. */
export async function GET() {
  try {
    const [health, runs, failures, counts, classes] = await Promise.all([
      getHealth(),
      recentRuns(),
      openFailures().catch(() => []),
      dashboardCounts(),
      query<{ name: string; trials: number }>(
        `SELECT obesity_class AS name, count(*)::int AS trials FROM trials t WHERE t.is_active AND ${hasDrug("t")} GROUP BY 1`,
      ).catch(() => []),
    ]);
    return NextResponse.json({
      health,
      runs,
      failures,
      counts,
      classes,
      lastSuccessfulSync: health.lastSuccessfulSync,
      sync: { configured: dispatchConfig().configured, actionsUrl: actionsUrl() },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "query failed" }, { status: 500 });
  }
}

/**
 * POST: start the sync on GitHub Actions (the daily workflow) — `?full=true` for
 * a full re-download. Allowed for signed-in users (or only ADMIN_USERS, if set).
 */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!mayAdminister(user)) {
    return NextResponse.json({ error: "Only admins can start a sync." }, { status: 403 });
  }
  const full = req.nextUrl.searchParams.get("full") === "true";
  const r = await dispatchSync(full);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ started: true, mode: full ? "full" : "daily", url: r.url });
}
