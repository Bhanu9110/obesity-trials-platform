import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authDisabled, readSession } from "@/lib/auth";
import { guestMayOpen } from "@/lib/guest-pages";
import {
  QUALITY_BANDS,
  isQualityBand,
  qualityIssueCounts,
  qualityOverview,
  qualityTrials,
  type QualityBand,
} from "@/lib/queries";
import { Chips, ContinentChips, Dash, NctLink, PhaseText } from "@/components/ui";
import { QUALITY_HELP, QUALITY_LABELS, SEV_STYLE } from "@/lib/quality-labels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Tone = { text: string; ring: string };
const TONES: Record<QualityBand | "all", Tone> = {
  all: { text: "text-slate-900", ring: "ring-slate-300" },
  clean: { text: "text-emerald-600", ring: "ring-emerald-300" },
  minor: { text: "text-sky-600", ring: "ring-sky-300" },
  review: { text: "text-amber-600", ring: "ring-amber-300" },
  poor: { text: "text-rose-600", ring: "ring-rose-300" },
};

function Tile({
  label, value, sub, tone, href, active,
}: { label: string; value: string; sub?: string; tone: Tone; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`block rounded-xl border bg-white p-4 transition hover:border-slate-300 hover:shadow-sm ${
        active ? `border-transparent ring-2 ${tone.ring}` : "border-slate-200"
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${tone.text}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </Link>
  );
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; band?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const code = sp.code && /^[A-Z_]+$/.test(sp.code) ? sp.code : undefined;
  const band = isQualityBand(sp.band) ? sp.band : undefined;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [o, issues, list] = await Promise.all([
    qualityOverview(),
    qualityIssueCounts(band),
    qualityTrials({ code, band, q }, page, PAGE_SIZE),
  ]);
  const pct = (n: number) => (o.checked ? `${Math.round((n / o.checked) * 100)}%` : "—");
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  const params = (over: { code?: string | null; band?: string | null; page?: number }) => {
    const p = new URLSearchParams();
    const b = over.band === undefined ? band : over.band;
    const c = over.code === undefined ? code : over.code;
    if (b) p.set("band", b);
    if (c) p.set("code", c);
    if (q) p.set("q", q);
    if ((over.page ?? 1) > 1) p.set("page", String(over.page));
    return p;
  };
  const href = (over: { code?: string | null; band?: string | null; page?: number }) => {
    const s = params(over).toString();
    return `/quality${s ? `?${s}` : ""}`;
  };
  // Clicking the selected tile again clears it.
  const bandHref = (b: QualityBand | null) => href({ band: band === b ? null : b, code: null, page: 1 });
  const csvHref = `/api/quality/export?${params({ page: 1 }).toString()}`;
  // Guests see the download only if their access includes it.
  const session = authDisabled() ? null : await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  const canDownload = !session?.pages || guestMayOpen(session.pages, "/api/quality/export");

  const title = [
    band ? QUALITY_BANDS[band].label : code ? null : "All trials with issues",
    code ? `“${QUALITY_LABELS[code] ?? code}”` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Quality control"
        title="Data"
        highlight="quality"
        description="Every trial is checked automatically each time it is synced (score 1.00 = no issues). Click a tile or an issue to list those trials."
      />

      {o.checked === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No quality results yet. They appear after the next sync (the first sync after an upgrade
          fills them in for every trial).
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Average score" value={o.avgScore != null ? o.avgScore.toFixed(2) : "—"}
                sub={`${o.checked.toLocaleString()} trials checked`} tone={TONES.all}
                href={href({ band: null, code: null, page: 1 })} active={!band && !code} />
          <Tile label={QUALITY_BANDS.clean.label} value={o.clean.toLocaleString()} sub={pct(o.clean)} tone={TONES.clean}
                href={bandHref("clean")} active={band === "clean"} />
          <Tile label={QUALITY_BANDS.minor.label} value={o.minor.toLocaleString()} sub={pct(o.minor)} tone={TONES.minor}
                href={bandHref("minor")} active={band === "minor"} />
          <Tile label={QUALITY_BANDS.review.label} value={o.needsReview.toLocaleString()} sub={pct(o.needsReview)} tone={TONES.review}
                href={bandHref("review")} active={band === "review"} />
          <Tile label={QUALITY_BANDS.poor.label} value={o.poor.toLocaleString()} sub={pct(o.poor)} tone={TONES.poor}
                href={bandHref("poor")} active={band === "poor"} />
        </div>
      )}

      {o.totalTrials > 0 && o.withLineage < o.totalTrials && (
        <p className="text-xs text-slate-500">
          {(o.totalTrials - o.withLineage).toLocaleString()} of {o.totalTrials.toLocaleString()} trials have no source
          record yet, so they have no quality check — they are filled in by the next full sync.
        </p>
      )}

      {band !== "clean" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Issues found{band ? ` in “${QUALITY_BANDS[band].label}”` : ""}
          </h2>
          {issues.length === 0 ? (
            <p className="text-sm text-emerald-600">No issues found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link
                href={href({ code: null, page: 1 })}
                scroll={false}
                className={`rounded-full border px-3 py-1 text-xs ${!code ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                All issues
              </Link>
              {issues.map((i) => (
                <Link
                  key={i.code}
                  href={href({ code: code === i.code ? null : i.code, page: 1 })}
                  scroll={false}
                  title={QUALITY_HELP[i.code] ?? i.code}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${code === i.code ? "border-brand-600 ring-2 ring-brand-100" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[i.severity] ?? ""}`}>{i.severity}</span>
                  <span className="text-slate-700">{QUALITY_LABELS[i.code] ?? i.code}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{i.trials.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section id="trials" className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="text-sm font-semibold text-slate-900">
            {title} ({list.total.toLocaleString()})
            {(band || code || q) && (
              <Link href="/quality" scroll={false} className="ml-3 text-xs font-normal text-brand-600 hover:underline">
                Clear filters
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action="/quality" className="flex gap-2">
              {band && <input type="hidden" name="band" value={band} />}
              {code && <input type="hidden" name="code" value={code} />}
              <input
                name="q"
                defaultValue={q}
                placeholder="Find — NCT ID, sponsor, indication, drug…"
                className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500"
              />
            </form>
            {canDownload && <a
              href={csvHref}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              title="Download this list (all pages) as a CSV file for Excel"
            >
              Download CSV
            </a>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Trial ID</th>
                <th className="px-5 py-2.5 font-semibold">Score</th>
                <th className="px-5 py-2.5 font-semibold">Issues</th>
                <th className="px-5 py-2.5 font-semibold">Indication</th>
                <th className="px-5 py-2.5 font-semibold">Phase</th>
                <th className="px-5 py-2.5 font-semibold">Sponsor</th>
                <th className="px-5 py-2.5 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.items.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No trials.</td></tr>
              ) : (
                list.items.map((t) => (
                  <tr key={t.nct_id} className="align-top hover:bg-slate-50">
                    <td className="px-5 py-2.5"><NctLink id={t.nct_id} /></td>
                    <td className={`px-5 py-2.5 font-semibold tabular-nums ${
                      t.score >= 1 ? TONES.clean.text : t.score >= 0.9 ? TONES.minor.text : t.score >= 0.75 ? TONES.review.text : TONES.poor.text
                    }`}>
                      {t.score.toFixed(2)}
                    </td>
                    <td className="px-5 py-2.5">
                      {t.issues.length === 0 ? (
                        <span className="text-xs text-emerald-600">No issues</span>
                      ) : (
                        <ul className="space-y-1">
                          {t.issues.map((i) => (
                            <li key={i.code} className="text-xs">
                              <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_STYLE[i.severity] ?? ""}`}>{i.severity}</span>
                              <span className="text-slate-700" title={QUALITY_HELP[i.code]}>{QUALITY_LABELS[i.code] ?? i.message}</span>
                              {i.detail?.length ? (
                                <span className="text-slate-400" title={i.detail.join(", ")}>
                                  {" "}— {i.detail.slice(0, 3).join(", ")}{i.detail.length > 3 ? ` +${i.detail.length - 3} more` : ""}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-5 py-2.5"><Chips values={t.indication} max={2} /></td>
                    <td className="px-5 py-2.5 text-slate-700"><PhaseText phase={t.phase} /></td>
                    <td className="px-5 py-2.5 text-slate-700">{t.sponsor || <Dash />}</td>
                    <td className="px-5 py-2.5"><ContinentChips continents={t.continents} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-slate-100 py-3 text-sm">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-lg border border-slate-200 px-3 py-1.5">Prev</Link> : <span className="px-3 py-1.5 text-slate-300">Prev</span>}
            <span className="text-slate-500">Page {page} of {pages}</span>
            {page < pages ? <Link href={href({ page: page + 1 })} className="rounded-lg border border-slate-200 px-3 py-1.5">Next</Link> : <span className="px-3 py-1.5 text-slate-300">Next</span>}
          </div>
        )}
      </section>
    </div>
  );
}
