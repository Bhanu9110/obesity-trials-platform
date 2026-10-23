import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { filterOptions } from "@/lib/queries";
import { dataVersion } from "@/lib/data-version";

export const dynamic = "force-dynamic";

// Filter choices and their counts only change with the data: keep them per server
// instance until the data fingerprint (lib/data-version.ts) changes, so they are
// never out of date and the heavier query still runs only after a change.
let cache: { version: string; data: Awaited<ReturnType<typeof filterOptions>> } | null = null;

export async function GET(req: NextRequest) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  try {
    const version = await dataVersion();
    if (!cache || cache.version !== version) cache = { version, data: await filterOptions() };
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 },
    );
  }
}
