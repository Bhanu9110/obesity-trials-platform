import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayExport } from "@/lib/admin";
import { SESSION_COOKIE, authDisabled, displayUsername, isGuest, readSession } from "@/lib/auth";
import { logAdminAction } from "@/lib/access-log";
import { buildTable } from "@/lib/exportData";
import { FORMATS, type Dataset, type ExportFormat } from "@/lib/exportColumns";
import { MIME, PRINT_LIMIT, fileName, makeFile } from "@/lib/exportFiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PREVIEW_ROWS = 2000;
const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });

/**
 * Data export (Trials explorer and Drugs list).
 *   ?type=trials|drugs  ?scope=filtered|all  ?cols=key,key,…  ?format=json|xlsx|pdf|csv|docx
 *   plus the list page's own filters (q, phase, status, stage, reg …) for scope=filtered.
 * format=json feeds the export page (preview + summary); a file download is written to the audit log.
 * Who: the super admin, owners and admins; members and guests when an admin allowed downloads
 * (Admin page). Guests also need the page itself (Trials / Drugs).
 */
export async function GET(req: NextRequest) {
  const user = await activeUser(req);
  if (!user) return deny("login required", 401);
  // ?check=1: may this login download? (shows or hides the Export button)
  if (req.nextUrl.searchParams.get("check")) return NextResponse.json({ allowed: await mayExport(user) }, { headers: { "Cache-Control": "no-store" } });
  if (!(await mayExport(user))) return deny("Downloading data isn't switched on for your login — ask an admin.");
  const sp = req.nextUrl.searchParams;
  const dataset: Dataset = sp.get("type") === "drugs" ? "drugs" : "trials";
  if (isGuest(user) && !authDisabled()) {
    const pages = (await readSession(req.cookies.get(SESSION_COOKIE)?.value))?.pages ?? [];
    if (!pages.includes(dataset)) return deny(`Your login can't open the ${dataset === "trials" ? "Trials" : "Drugs"} page.`);
  }
  const scope = sp.get("scope") === "all" ? "all" : "filtered";
  const cols = (sp.get("cols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const format = sp.get("format") ?? "json";
  try {
    const table = await buildTable(dataset, sp, scope, cols, req.nextUrl.origin);
    if (format === "json") {
      return NextResponse.json({ ...table, rows: table.rows.slice(0, PREVIEW_ROWS), previewLimit: PREVIEW_ROWS, printLimit: PRINT_LIMIT },
        { headers: { "Cache-Control": "no-store" } });
    }
    if (!FORMATS.some((f) => f.key === format)) return deny("Unknown format.", 400);
    const fmt = format as ExportFormat;
    const name = authDisabled() ? "local" : displayUsername(user);
    const buf = await makeFile(table, fmt, name);
    const label = FORMATS.find((f) => f.key === fmt)!.label;
    await logAdminAction("export", user, req,
      `${dataset === "trials" ? "trials" : "drugs"} as ${label} — ${table.rows.length.toLocaleString("en-US")} rows, ${table.columns.length} columns (${table.filters.join(" · ")})`.slice(0, 500));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[fmt],
        "Content-Disposition": `attachment; filename="${fileName(table, fmt)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "export failed" }, { status: 500 });
  }
}
