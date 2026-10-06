import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { trialPreview } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Quick-preview data for one trial (the slide-over panel in the Trials explorer). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ nct: string }> }) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  const nct = (await params).nct.toUpperCase();
  if (!/^NCT\d{8}$/.test(nct)) return NextResponse.json({ error: "not a trial ID" }, { status: 400 });
  try {
    const t = await trialPreview(nct);
    return t ? NextResponse.json(t) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
