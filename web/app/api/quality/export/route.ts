import { NextRequest, NextResponse } from "next/server";
import { isQualityBand, qualityTrials } from "@/lib/queries";
import { QUALITY_LABELS } from "@/lib/quality-labels";
import { formatPhase } from "@/lib/format";

export const dynamic = "force-dynamic";

/** CSV of the Data quality list for the current filter (band / issue / search), all pages. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code") && /^[A-Z_]+$/.test(sp.get("code")!) ? sp.get("code")! : undefined;
  const bandRaw = sp.get("band");
  const band = isQualityBand(bandRaw) ? bandRaw : undefined;
  const q = (sp.get("q") ?? "").trim().slice(0, 100) || undefined;
  try {
    const { items } = await qualityTrials({ code, band, q }, 1, 0);
    // Cells starting with = + - @ are prefixed so Excel never runs them as formulas.
    const cell = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ["Trial ID", "Link", "Score", "Issues", "Issue details", "Indication", "Phase", "Sponsor", "Interventions", "Continents", "Checked"];
    const lines = items.map((t) =>
      [
        t.nct_id,
        `https://clinicaltrials.gov/study/${t.nct_id}`,
        t.score.toFixed(2),
        t.issues.map((i) => `${i.severity.toUpperCase()}: ${QUALITY_LABELS[i.code] ?? i.message}`).join("; "),
        t.issues.filter((i) => i.detail?.length).map((i) => `${QUALITY_LABELS[i.code] ?? i.code}: ${i.detail!.join(", ")}`).join("; "),
        (t.indication ?? []).join("; "),
        formatPhase(t.phase),
        t.sponsor ?? "",
        (t.interventions ?? []).join("; "),
        (t.continents ?? []).join("; "),
        t.checked_at,
      ].map(cell).join(","),
    );
    const name = ["data-quality", band, code?.toLowerCase(), new Date().toISOString().slice(0, 10)].filter(Boolean).join("-");
    return new NextResponse("﻿" + [header.map(cell).join(","), ...lines].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "export failed" }, { status: 500 });
  }
}
