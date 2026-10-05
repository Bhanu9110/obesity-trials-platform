import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { filterOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Filter choices only change with the daily sync: keep them for 10 minutes per
// server instance instead of querying the database on every page load.
let cache: { at: number; data: Awaited<ReturnType<typeof filterOptions>> } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), data: await filterOptions() };
    return NextResponse.json(cache.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 },
    );
  }
}
