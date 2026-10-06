import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayEdit } from "@/lib/admin";
import { updateProductSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** PUT { summary } — the hand-written product summary (members and owners; never guests). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) {
    return NextResponse.json({ error: "Guest access is view-only." }, { status: 403 });
  }
  const { slug } = await params;
  let summary: string | null = null;
  try {
    const raw = String((await req.json())?.summary ?? "").replace(/\r\n/g, "\n").trim();
    summary = raw ? raw.slice(0, 4000) : null;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const p = await updateProductSummary(decodeURIComponent(slug), summary);
    return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    return NextResponse.json(
      { error: /summary/.test(msg) ? "Summaries can be saved after the next sync updates the database (migration 0016)." : msg },
      { status: 500 },
    );
  }
}
