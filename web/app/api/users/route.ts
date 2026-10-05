import { NextRequest, NextResponse } from "next/server";
import { currentUser, mayAdminister } from "@/lib/admin";
import { configuredUsers } from "@/lib/auth";
import { UserError, createUser, deleteUser, listUsers, updateUser, type UserAction } from "@/lib/site-users";

export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Only owners can manage users." }, { status: 403 });

function failure(err: unknown) {
  if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 400 });
  const msg = err instanceof Error ? err.message : "failed";
  return NextResponse.json(
    { error: /site_users|guest_access/.test(msg) ? "Users & access starts after the next sync updates the database (migration 0015)." : msg },
    { status: 500 },
  );
}

export interface OwnerRow { username: string; admin: boolean }

/** Owners (AUTH_USERS, read-only here) and every login made on the Admin page. */
export async function GET(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return forbidden();
  const owners: OwnerRow[] = configuredUsers().map((u) => ({ username: u, admin: mayAdminister(u) }));
  try {
    return NextResponse.json({ owners, users: await listUsers() });
  } catch (err) {
    return failure(err);
  }
}

/** Add a login: { label, username?, password?, role, minutes (null = no end date, members), pages? } */
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!mayAdminister(me)) return forbidden();
  try {
    const b = await req.json().catch(() => ({}));
    const created = await createUser({
      label: String(b?.label ?? ""),
      username: b?.username ? String(b.username) : undefined,
      password: b?.password ? String(b.password) : undefined,
      role: b?.role,
      minutes: b?.minutes === null || b?.minutes === undefined ? null : Number(b.minutes),
      pages: b?.pages,
      createdBy: me,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}

/** Change a login: { id, action, ...details } (see UserAction). */
export async function PATCH(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return forbidden();
  try {
    const b = await req.json().catch(() => ({}));
    const id = Number(b?.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
    const r = await updateUser(id, b as UserAction);
    return r.user ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return failure(err);
  }
}

/** Delete a login for good: ?id=… (their activity history stays in the access log). */
export async function DELETE(req: NextRequest) {
  if (!mayAdminister(await currentUser(req))) return forbidden();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    return (await deleteUser(id))
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return failure(err);
  }
}
