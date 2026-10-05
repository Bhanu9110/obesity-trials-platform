import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/admin";
import { logAccess } from "@/lib/access-log";

export const dynamic = "force-dynamic";

/** Records one page view of the signed-in member (sent by the site on every page change). */
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "login required" }, { status: 401 });
  let path = "";
  try {
    path = String((await req.json())?.path ?? "");
  } catch { /* ignore */ }
  if (!/^\/[\w\-./%?=&]*$/.test(path)) path = "/";
  if (user !== "local") await logAccess("page", user, req, path);
  return new NextResponse(null, { status: 204 });
}
