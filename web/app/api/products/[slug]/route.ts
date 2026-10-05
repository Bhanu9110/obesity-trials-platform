import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayEdit } from "@/lib/admin";
import { getProduct, updateProductInfo } from "@/lib/queries";
import { PRODUCT_INFO_FIELDS, type ProductInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProduct(decodeURIComponent(slug));
  return p ? NextResponse.json(p) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** Save the manually curated product info. Blank strings are stored as empty (NULL). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) {
    return NextResponse.json({ error: "Guest access is view-only." }, { status: 403 });
  }
  const { slug } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const info = {} as ProductInfo;
  for (const k of PRODUCT_INFO_FIELDS) {
    const v = body[k];
    const s = typeof v === "string" ? v.trim().slice(0, 500) : "";
    info[k] = s === "" ? null : s;
  }
  if (info.candidate !== null && info.candidate !== "Pipeline" && info.candidate !== "Non-pipeline") {
    return NextResponse.json({ error: "candidate must be Pipeline, Non-pipeline or blank" }, { status: 400 });
  }
  if (info.approved !== null && info.approved !== "Yes" && info.approved !== "No") {
    return NextResponse.json({ error: "approved must be Yes, No or blank" }, { status: 400 });
  }
  if (info.approval_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(info.approval_date) || isNaN(Date.parse(info.approval_date))) {
      return NextResponse.json({ error: "approval date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (info.approved !== "Yes") {
      return NextResponse.json({ error: "approval date needs Approved = Yes" }, { status: 400 });
    }
  }

  try {
    const updated = await updateProductInfo(decodeURIComponent(slug), info);
    return updated
      ? NextResponse.json(updated)
      : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}
