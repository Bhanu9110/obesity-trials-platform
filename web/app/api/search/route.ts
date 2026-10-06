import { NextRequest, NextResponse } from "next/server";
import { activeUser } from "@/lib/admin";
import { SESSION_COOKIE, authDisabled, readSession } from "@/lib/auth";
import { globalSearch } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Global search (Ctrl/⌘ K). Guests only get results from the pages they may open. */
export async function GET(req: NextRequest) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ trials: [], drugs: [], sponsors: [] });
  const session = authDisabled() ? null : await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const pages = session?.pages; // undefined = owner/member: everything
  try {
    const r = await globalSearch(q, {
      trials: !pages || pages.includes("trials"),
      drugs: !pages || pages.includes("drugs"),
    });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
