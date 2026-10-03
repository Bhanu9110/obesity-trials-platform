import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Public health check for uptime monitors (no login needed, no data returned).
 * 200 when ok or warn, 503 when something is broken (database down, migrations
 * missing, no successful sync for 3 days).
 */
export async function GET() {
  try {
    const h = await getHealth();
    return NextResponse.json(
      {
        status: h.status,
        checkedAt: h.checkedAt,
        lastSuccessfulSync: h.lastSuccessfulSync,
        hoursSinceSync: h.hoursSinceSync,
        checks: h.checks.map((c) => ({ name: c.name, status: c.status })),
      },
      { status: h.status === "fail" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "fail" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
