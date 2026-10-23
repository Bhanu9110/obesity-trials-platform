import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { dataVersion } from "@/lib/data-version";

export const dynamic = "force-dynamic";

/** The data fingerprint open pages poll to know when to reload their numbers (components/LiveRefresh.tsx). */
export async function GET(req: NextRequest) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  try {
    return NextResponse.json({ v: await dataVersion() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
