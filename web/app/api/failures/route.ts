import { NextRequest, NextResponse } from "next/server";
import { updateFailure } from "@/lib/queries";
import { currentUser, mayAdminister } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** POST {nct_id, action: "requeue" | "dismiss"} — manage the retry / dead-letter queue. */
export async function POST(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) {
    return NextResponse.json({ error: "Only admins can change the queue." }, { status: 403 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const id = String(body?.nct_id ?? "").toUpperCase();
  const action = body?.action;
  if (!/^[A-Z0-9_-]{1,40}$/.test(id) || (action !== "requeue" && action !== "dismiss")) {
    return NextResponse.json({ error: "nct_id and action (requeue | dismiss) required" }, { status: 400 });
  }
  const ok = await updateFailure(id, action);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "no open entry for this trial" }, { status: 404 });
}
