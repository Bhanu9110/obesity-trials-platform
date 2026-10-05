import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayEdit } from "@/lib/admin";
import { mergeProduct } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** POST { into: "<target slug>" } — merge this drug into another one. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) {
    return NextResponse.json({ error: "Guest access is view-only." }, { status: 403 });
  }
  const { slug } = await params;
  let into = "";
  try {
    into = String((await req.json())?.into ?? "").trim();
  } catch {
    /* fall through */
  }
  if (!into) return NextResponse.json({ error: "choose the drug to merge into" }, { status: 400 });
  try {
    const target = await mergeProduct(decodeURIComponent(slug), into);
    return NextResponse.json({ merged: true, into: target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "merge failed" },
      { status: 400 },
    );
  }
}
