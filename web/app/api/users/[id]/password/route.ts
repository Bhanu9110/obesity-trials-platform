import { NextRequest, NextResponse } from "next/server";
import { adminLevel, currentUser } from "@/lib/admin";
import { getUserRole, revealPassword } from "@/lib/site-users";

export const dynamic = "force-dynamic";

/** The kept copy of a login's password (admins; an admin's password: the super admin only; never cached). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const level = await adminLevel(await currentUser(req));
  if (!level) return NextResponse.json({ error: "Only admins can see passwords." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const target = await getUserRole(id);
    if (target?.role === "admin" && level !== "super") {
      return NextResponse.json({ error: "Only the super admin can see an admin's password." }, { status: 403 });
    }
    const r = await revealPassword(id);
    if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
