import { NextRequest, NextResponse } from "next/server";
import { listTrials, type TrialFilters } from "@/lib/queries";
import { activeUser } from "@/lib/admin";

export const dynamic = "force-dynamic";

function multi(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split("|").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

// List params use "|" as the separator because country names contain commas
// ("Korea, Republic of"). sponsorClass also accepts commas.
export async function GET(req: NextRequest) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const filters: TrialFilters = {
    q: sp.get("q")?.trim() || undefined,
    phase: multi(sp.get("phase")),
    continent: multi(sp.get("continent")),
    country: multi(sp.get("country")),
    sponsorClass: sp.get("sponsorClass")?.split(/[|,]/).map((s) => s.trim()).filter(Boolean),
    scope: sp.get("scope") ?? undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 20,
  };

  try {
    const { items, total } = await listTrials(filters);
    return NextResponse.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 },
    );
  }
}
