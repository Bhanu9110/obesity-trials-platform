import { NextRequest, NextResponse } from "next/server";
import { currentUser, mayAdminister } from "@/lib/admin";
import { GuestError, createGuest, listGuests, updateGuest } from "@/lib/guests";

export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Only admins can manage guest access." }, { status: 403 });

function failure(err: unknown) {
  if (err instanceof GuestError) return NextResponse.json({ error: err.message }, { status: 400 });
  const msg = err instanceof Error ? err.message : "failed";
  return NextResponse.json(
    { error: /guest_access/.test(msg) ? "Guest access starts after the next sync adds its table (migration 0013)." : msg },
    { status: 500 },
  );
}

/** All guest logins (admins only). */
export async function GET(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return forbidden();
  try {
    return NextResponse.json({ guests: await listGuests() });
  } catch (err) {
    return failure(err);
  }
}

/** Create a guest login: { label, username?, minutes }. The password is returned only in this response. */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!mayAdminister(user)) return forbidden();
  try {
    const body = await req.json().catch(() => ({}));
    const created = await createGuest({
      label: String(body?.label ?? ""),
      username: body?.username ? String(body.username) : undefined,
      minutes: Number(body?.minutes),
      createdBy: user,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}

/** { id, action: "revoke" | "extend", minutes? } */
export async function PATCH(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return forbidden();
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const action = body?.action;
    if (!Number.isInteger(id) || (action !== "revoke" && action !== "extend")) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    const guest = await updateGuest(id, action, Number(body?.minutes ?? 60));
    return guest ? NextResponse.json({ guest }) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return failure(err);
  }
}
