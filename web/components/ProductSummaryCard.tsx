"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";

// "Product summary": the whole picture of one drug in one box — the hand-written
// summary, the filled-in profile fields, and what the trials say (counted, not guessed).

export interface SummaryFacts {
  trials: number;
  topPhase: string | null;
  phases: { label: string; count: number }[];
  recruiting: number;
  active: number;
  completed: number;
  stopped: number;
  sponsors: number;
  industry: number;
  topSponsors: { name: string; count: number }[];
  regions: { name: string; count: number }[];
  participants: number;
  firstStart: string | null;   // "Mar 2014"
  latestStart: string | null;
  topConditions: { name: string; count: number }[];
}

const PROFILE_ROWS: { key: keyof Product; label: string }[] = [
  { key: "brand_names", label: "Brand name" },
  { key: "aliases", label: "Alias / code names" },
  { key: "sponsor", label: "Company" },
  { key: "candidate", label: "Candidate" },
  { key: "parent_drug", label: "Similar / parent drug" },
  { key: "drug_class", label: "Therapy class" },
  { key: "therapy_subclass", label: "Therapy subclass" },
  { key: "moa", label: "Mechanism of action" },
  { key: "modality", label: "Modality" },
  { key: "roa", label: "Route of administration" },
  { key: "indication", label: "Indication" },
  { key: "phase", label: "Development phase" },
];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One readable paragraph built only from counted trial facts. */
export function snapshotText(name: string, f: SummaryFacts): string {
  if (!f.trials) return `${name} has no primary-obesity trials in the database yet.`;
  const parts = [
    `${name} appears in ${f.trials.toLocaleString()} primary-obesity trial${f.trials === 1 ? "" : "s"}` +
      (f.topPhase ? `, the most advanced in ${f.topPhase}.` : "."),
  ];
  const open = f.recruiting + f.active;
  if (open) parts.push(`${open.toLocaleString()} ${open === 1 ? "is" : "are"} ongoing (${f.recruiting} recruiting or about to start), ${f.completed} completed${f.stopped ? ` and ${f.stopped} stopped early` : ""}.`);
  else parts.push(`${f.completed} completed${f.stopped ? `, ${f.stopped} stopped early` : ""}.`);
  if (f.topSponsors.length) {
    parts.push(`${pct(f.industry, f.trials)}% are industry-sponsored; the most active sponsor is ${f.topSponsors[0].name} (${f.topSponsors[0].count} trial${f.topSponsors[0].count === 1 ? "" : "s"}) among ${f.sponsors} sponsors.`);
  }
  if (f.regions.length) parts.push(`Trials run in ${list(f.regions.slice(0, 4).map((r) => r.name))}${f.regions.length > 4 ? " and more" : ""}.`);
  if (f.participants) parts.push(`Together they plan to enrol about ${f.participants.toLocaleString()} participants.`);
  if (f.firstStart && f.latestStart) parts.push(f.firstStart === f.latestStart ? `Start date: ${f.firstStart}.` : `Start dates range from ${f.firstStart} to ${f.latestStart}.`);
  return parts.join(" ");
}

export default function ProductSummaryCard({
  product, facts, readOnly = false,
}: { product: Product; facts: SummaryFacts; readOnly?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(product.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const filled = PROFILE_ROWS.filter((r) => String(product[r.key] ?? "").trim());
  const approval = product.approved === "Yes"
    ? `Approved${product.approval_date ? ` · ${new Date(`${product.approval_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}`
    : product.approved === "No" ? "Not approved" : null;
  const snapshot = snapshotText(product.name, facts);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/products/${encodeURIComponent(product.slug)}/summary`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: text }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    const lines = [
      `${product.name} — product summary`,
      "",
      ...(product.summary ? [product.summary, ""] : []),
      ...filled.map((r) => `${r.label}: ${product[r.key]}`),
      ...(approval ? [`Approval: ${approval}`] : []),
      "",
      `Trials: ${facts.trials}${facts.topPhase ? ` (most advanced: ${facts.topPhase})` : ""}`,
      `By phase: ${facts.phases.map((p) => `${p.label} ${p.count}`).join(", ")}`,
      `Status: ${facts.recruiting} recruiting/opening, ${facts.active} active, ${facts.completed} completed, ${facts.stopped} stopped`,
      `Sponsors: ${facts.sponsors} (${pct(facts.industry, facts.trials)}% industry) — ${facts.topSponsors.map((s) => `${s.name} (${s.count})`).join(", ")}`,
      `Regions: ${facts.regions.map((r) => `${r.name} (${r.count})`).join(", ")}`,
      ...(facts.participants ? [`Planned participants: ${facts.participants.toLocaleString()}`] : []),
      ...(facts.firstStart ? [`Start dates: ${facts.firstStart} – ${facts.latestStart}`] : []),
      "",
      snapshot,
      "",
      `Source: Obesity Trials Intelligence · ${window.location.href.split("?")[0]}`,
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950";
  const fact = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-0.5 font-display text-[15px] font-semibold text-slate-950">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
      <span className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-950">Product summary</h2>
          <p className="text-xs text-slate-500">The complete picture of {product.name}: your summary, its profile and what its trials show.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className={btn}>{copied ? "Copied ✓" : "Copy summary"}</button>
          {!readOnly && !editing && <button type="button" onClick={() => { setText(product.summary ?? ""); setEditing(true); }} className={btn}>{product.summary ? "Edit summary" : "Write summary"}</button>}
        </div>
      </div>

      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {editing ? (
            <div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={4000} autoFocus
                        placeholder={`What ${product.name} is, how it works, who develops it, where it stands…`}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-relaxed outline-none" />
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-60">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={saving} className={btn}>Cancel</button>
                <span className="ml-auto text-xs text-slate-400">{text.length.toLocaleString()} / 4,000</span>
              </div>
              {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            </div>
          ) : product.summary ? (
            <div>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{product.summary}</p>
              {product.summary_updated_at && (
                <p className="mt-1.5 text-[11px] text-slate-400">Written by our team · updated {new Date(product.summary_updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
              )}
            </div>
          ) : !readOnly ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
              No written summary yet — click <b className="text-slate-700">Write summary</b> to describe the drug in a few lines.
            </p>
          ) : null}

          <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700">Pipeline snapshot · from the trials</div>
            <p className="text-sm leading-relaxed text-slate-700">{snapshot}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {fact("Ongoing", (facts.recruiting + facts.active).toLocaleString(), `${facts.recruiting} recruiting or opening`)}
            {fact("Completed", facts.completed.toLocaleString(), facts.stopped ? `${facts.stopped} stopped early` : "none stopped early")}
            {fact("Industry share", `${pct(facts.industry, facts.trials)}%`, `${facts.industry} of ${facts.trials} trials`)}
            {fact("Planned participants", facts.participants ? facts.participants.toLocaleString() : "—", "sum of enrolment targets")}
            {fact("Start dates", facts.firstStart ? (facts.firstStart === facts.latestStart ? facts.firstStart : `${facts.firstStart.slice(-4)}–${facts.latestStart?.slice(-4)}`) : "—", facts.firstStart && facts.firstStart !== facts.latestStart ? `${facts.firstStart} → ${facts.latestStart}` : undefined)}
            {fact("Sponsors", facts.sponsors.toLocaleString(), facts.topSponsors[0] ? `led by ${facts.topSponsors[0].name}` : undefined)}
          </div>

          {facts.phases.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Trials by phase</div>
              <div className="flex flex-wrap gap-1.5">
                {facts.phases.map((p) => (
                  <span key={p.label} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                    {p.label} <b className="ml-1 tabular-nums text-slate-950">{p.count}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Profile</div>
            {filled.length || approval ? (
              <dl className="space-y-2 text-sm">
                {filled.map((r) => (
                  <div key={r.key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <dt className="text-slate-500">{r.label}</dt>
                    <dd className="break-words font-medium text-slate-900">{String(product[r.key])}</dd>
                  </div>
                ))}
                {approval && (
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <dt className="text-slate-500">Approval</dt>
                    <dd className={`font-medium ${product.approved === "Yes" ? "text-emerald-700" : "text-slate-900"}`}>{approval}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Profile fields aren&apos;t filled in yet{readOnly ? "." : " — use Edit in the Drug profile below."}</p>
            )}
          </div>

          {facts.topSponsors.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Top sponsors</div>
              <ul className="space-y-1 text-sm">
                {facts.topSponsors.map((s) => (
                  <li key={s.name} className="flex justify-between gap-3"><span className="truncate text-slate-800">{s.name}</span><span className="tabular-nums text-slate-500">{s.count}</span></li>
                ))}
              </ul>
            </div>
          )}

          {facts.topConditions.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Studied in</div>
              <div className="flex flex-wrap gap-1">
                {facts.topConditions.map((c) => (
                  <span key={c.name} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">{c.name} <span className="text-slate-400">{c.count}</span></span>
                ))}
              </div>
            </div>
          )}

          {facts.regions.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Regions</div>
              <div className="flex flex-wrap gap-1">
                {facts.regions.map((r) => (
                  <span key={r.name} className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200/60">{r.name} <span className="opacity-70">{r.count}</span></span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
