import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayEdit } from "@/lib/admin";
import { updateProductKind } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KINDS = ["drug", "supplement", "not_drug"] as const;

/** Keep this entry in the drug list ("drug") or leave it out ("supplement" / "not_drug"). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) {
    return NextResponse.json({ error: "Guest access is view-only." }, { status: 403 });
  }
  const { slug } = await params;
  let kind: unknown;
  try {
    kind = (await req.json())?.kind;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "kind must be drug, supplement or not_drug" }, { status: 400 });
  }
  try {
    const p = await updateProductKind(decodeURIComponent(slug), kind as (typeof KINDS)[number]);
    return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "update failed" }, { status: 500 });
  }
}
