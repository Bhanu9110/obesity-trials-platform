import { NextRequest, NextResponse } from "next/server";
import { currentUser, mayAdminister } from "@/lib/admin";
import { revealPassword } from "@/lib/site-users";

export const dynamic = "force-dynamic";

/** The kept copy of a login's password (owners only, never cached). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!mayAdminister(await currentUser(req))) {
    return NextResponse.json({ error: "Only owners can see passwords." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const r = await revealPassword(id);
    if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
