import { NextRequest, NextResponse } from "next/server";
import { adminLevel, currentUser, ownerLevel, superAdminInfo, type AdminLevel } from "@/lib/admin";
import { logAdminAction } from "@/lib/access-log";
import { configuredUsers, displayUsername } from "@/lib/auth";
import { UserError, createUser, deleteUser, getUserRole, listUsers, updateUser, type UserAction } from "@/lib/site-users";

export const dynamic = "force-dynamic";

// Who may do what (lib/admin.ts):
//   super admin — every login, including admins
//   admin       — members and guests only; can't create admins, nor change or remove one
const forbidden = (msg = "Only admins can manage users.") => NextResponse.json({ error: msg }, { status: 403 });
const onlySuper = () => forbidden("Only the super admin can create, change or remove admins.");

function failure(err: unknown) {
  if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 400 });
  const msg = err instanceof Error ? err.message : "failed";
  return NextResponse.json(
    { error: /site_users|guest_access/.test(msg) ? "Users & access starts after the next sync updates the database (migration 0023)." : msg },
    { status: 500 },
  );
}

export interface OwnerRow { username: string; display: string; admin: boolean; superAdmin: boolean }

/** Owners (AUTH_USERS, read-only here), every login made on the Admin page, and what the caller may do. */
export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  const level = await adminLevel(me);
  if (!level) return forbidden();
  const owners: OwnerRow[] = configuredUsers().map((u) => {
    const l = ownerLevel(u);
    return { username: u, display: displayUsername(u), admin: l !== null, superAdmin: l === "super" };
  });
  try {
    const sa = superAdminInfo();
    return NextResponse.json({
      owners, users: await listUsers(),
      me: { level, superAdmin: sa.name ? displayUsername(sa.name) : null, superAdminSource: sa.source, superAdminSetting: sa.setting },
    });
  } catch (err) {
    return failure(err);
  }
}

/** Add a login: { label, username?, password?, role, minutes (null = no end date: admins, members), pages? } */
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  const level = await adminLevel(me);
  if (!level) return forbidden();
  try {
    const b = await req.json().catch(() => ({}));
    if (b?.role === "admin" && level !== "super") return onlySuper();
    const created = await createUser({
      label: String(b?.label ?? ""),
      username: b?.username ? String(b.username) : undefined,
      password: b?.password ? String(b.password) : undefined,
      role: b?.role,
      minutes: b?.minutes === null || b?.minutes === undefined ? null : Number(b.minutes),
      pages: b?.pages,
      createdBy: me,
    });
    await logAdminAction("user_added", me, req, `${created.user.role} ${created.user.username}`);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}

/** May this caller change / remove login `id`? (admins can't touch admins) */
async function allowed(level: AdminLevel, id: number): Promise<{ ok: true; username: string; role: string } | { ok: false; res: NextResponse }> {
  const target = await getUserRole(id);
  if (!target) return { ok: false, res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (target.role === "admin" && level !== "super") return { ok: false, res: onlySuper() };
  return { ok: true, username: target.username, role: target.role };
}

/** Change a login: { id, action, ...details } (see UserAction). */
export async function PATCH(req: NextRequest) {
  const me = await currentUser(req);
  const level = await adminLevel(me);
  if (!level) return forbidden();
  try {
    const b = await req.json().catch(() => ({}));
    const id = Number(b?.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
    const check = await allowed(level, id);
    if (!check.ok) return check.res;
    if (b?.action === "role" && b?.role === "admin" && level !== "super") return onlySuper();
    const r = await updateUser(id, b as UserAction);
    if (!r.user) return NextResponse.json({ error: "not found" }, { status: 404 });
    const what = b.action === "role" ? `role → ${r.user.role}` : String(b.action);
    await logAdminAction(b.action === "password" ? "password_changed" : "user_changed", me, req, `${check.username}: ${what}`);
    return NextResponse.json(r);
  } catch (err) {
    return failure(err);
  }
}

/** Delete a login for good: ?id=… (their activity history stays in the audit log). */
export async function DELETE(req: NextRequest) {
  const me = await currentUser(req);
  const level = await adminLevel(me);
  if (!level) return forbidden();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const check = await allowed(level, id);
    if (!check.ok) return check.res;
    if (!(await deleteUser(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
    await logAdminAction("user_removed", me, req, `${check.role} ${check.username}`);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return failure(err);
  }
}
