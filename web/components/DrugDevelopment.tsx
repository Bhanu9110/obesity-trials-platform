"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MILESTONE_KINDS, MILESTONE_STATUSES, type MilestoneKind, type MilestoneStatus, type ProductMilestone, type ProductResult,
} from "@/lib/types";
import { KIND_META, STATUS_META, dateText, periodEnd } from "@/lib/milestones";

// Drug page: dated milestones (regulatory steps, readouts, launches, patent expiries,
// inflection points, upcoming milestones) and efficacy / safety results. Rows come from the
// research files (sync/data/profiles, marked "research") or are added here by editors.
// Research rows can be hidden but not changed (the next sync would put them back); rows
// added here can be changed and deleted.

// --------------------------------------------------------------------------- #
// Display helpers
// --------------------------------------------------------------------------- #

const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950 disabled:opacity-60";
const input = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 placeholder:text-slate-400";
const linkBtn = "text-xs font-medium text-slate-500 hover:text-brand-600";

function Card({ id, title, sub, right, children }: { id: string; title: string; sub: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function SourceLink({ label, url }: { label: string | null; url: string | null }) {
  if (!label && !url) return null;
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{label || "Source"} ↗</a>
    : <span className="text-slate-500">{label}</span>;
}

function Origin({ origin }: { origin: "curated" | "manual" }) {
  return origin === "curated"
    ? <span className="rounded bg-accent-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-700 ring-1 ring-accent-500/20" title="From the research files, updated by the daily sync">research</span>
    : <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200" title="Added on this page">added</span>;
}

async function send(slug: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, query?: string) {
  const r = await fetch(`/api/products/${encodeURIComponent(slug)}/development${query ? `?${query}` : ""}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(res.error ?? `HTTP ${r.status}`);
  return res;
}

// --------------------------------------------------------------------------- #
// Milestones
// --------------------------------------------------------------------------- #

type MForm = { kind: MilestoneKind; status: MilestoneStatus; date_label: string; title: string; region: string; detail: string; source_label: string; source_url: string };
const emptyM: MForm = { kind: "regulatory", status: "expected", date_label: "", title: "", region: "", detail: "", source_label: "", source_url: "" };

export function MilestonesCard({ slug, milestones, readOnly }: { slug: string; milestones: ProductMilestone[]; readOnly: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<"all" | "upcoming" | "past">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [form, setForm] = useState<MForm | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const today = useMemo(() => new Date(), []);

  const visible = milestones.filter((m) => showHidden || !m.hidden);
  const upcoming = visible.filter((m) => m.status === "expected" || m.status === "delayed");
  const past = visible.filter((m) => m.status === "done" || m.status === "cancelled").reverse(); // newest first
  const hiddenCount = milestones.filter((m) => m.hidden).length;
  const pastShown = showAllPast ? past : past.slice(0, 6);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  }
  async function save() {
    if (!form) return;
    const ok = await run(() => send(slug, editId ? "PATCH" : "POST", { type: "milestone", ...(editId ? { id: editId } : {}), ...form }));
    if (ok) { setForm(null); setEditId(null); }
  }
  const edit = (m: ProductMilestone) => {
    setEditId(m.id);
    setForm({ kind: m.kind, status: m.status, date_label: m.date_label ?? "", title: m.title, region: m.region ?? "", detail: m.detail ?? "",
      source_label: m.source_label ?? "", source_url: m.source_url ?? "" });
  };

  const row = (m: ProductMilestone, i: number, list: ProductMilestone[]) => {
    const k = KIND_META[m.kind];
    const end = periodEnd(m.date_label);
    const overdue = m.status === "expected" && end !== null && end.getTime() < today.getTime() - 86400000;
    return (
      <li key={m.id} className={`relative flex gap-4 pb-5 ${m.hidden ? "opacity-50" : ""}`}>
        {i < list.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />}
        <span className={`relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-white ring-1 ring-slate-200 ${k.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-sm font-semibold tabular-nums text-slate-900">{dateText(m.date_label)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${k.chip}`}>{k.label}</span>
            {m.status !== "done" && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[m.status].chip}`}>{STATUS_META[m.status].label}</span>}
            {overdue && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200" title="The expected date has passed — check whether it happened">Date passed — check</span>}
            {m.region && <span className="text-xs text-slate-500">{m.region}</span>}
            {m.hidden && <span className="text-[11px] font-medium text-slate-500">hidden</span>}
          </div>
          <p className="mt-1 text-[13.5px] leading-snug text-slate-800">{m.title}</p>
          {m.detail && <p className="mt-0.5 text-xs text-slate-500">{m.detail}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <SourceLink label={m.source_label} url={m.source_url} />
            {!readOnly && <Origin origin={m.origin} />}
            {!readOnly && (m.origin === "manual" ? (
              <>
                <button type="button" className={linkBtn} onClick={() => edit(m)}>Edit</button>
                <button type="button" className="text-xs font-medium text-rose-600 hover:underline" disabled={busy}
                        onClick={() => { if (confirmDel !== m.id) { setConfirmDel(m.id); return; } setConfirmDel(null); run(() => send(slug, "DELETE", undefined, `type=milestone&id=${m.id}`)); }}>
                  {confirmDel === m.id ? "Click again to delete" : "Delete"}
                </button>
              </>
            ) : (
              <button type="button" className={linkBtn} disabled={busy} onClick={() => run(() => send(slug, "PATCH", { type: "milestone", id: m.id, hidden: !m.hidden }))}>
                {m.hidden ? "Show" : "Hide"}
              </button>
            ))}
          </div>
        </div>
      </li>
    );
  };

  return (
    <Card
      id="milestones"
      title="Milestones & timeline"
      sub="Regulatory steps, trial readouts, launches, patent expiries and inflection points. Dates like Q4 2026 or 2027 are company guidance or registry estimates."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {([["all", "All"], ["upcoming", `Upcoming (${upcoming.length})`], ["past", `Past (${past.length})`]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)}
                      className={`rounded-md px-2.5 py-1 transition ${view === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{l}</button>
            ))}
          </div>
          {!readOnly && <button type="button" className={btn} onClick={() => { setEditId(null); setForm({ ...emptyM }); }}>+ Add milestone</button>}
        </div>
      }
    >
      {form && (
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-xs text-slate-500">Kind
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MilestoneKind })} className={`${input} mt-1`}>
                {MILESTONE_KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MilestoneStatus })} className={`${input} mt-1`}>
                {MILESTONE_STATUSES.map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Date
              <input value={form.date_label} onChange={(e) => setForm({ ...form, date_label: e.target.value })} placeholder="2026-03-19, 2026-Q4, 2027" className={`${input} mt-1`} />
            </label>
            <label className="text-xs text-slate-500">Region
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="US, EU, China…" className={`${input} mt-1`} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-4">What happens
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. FDA decision on the obesity application" className={`${input} mt-1`} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-4">Detail (optional)
              <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} rows={2} className={`${input} mt-1 resize-y`} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">Source name
              <input value={form.source_label} onChange={(e) => setForm({ ...form, source_label: e.target.value })} placeholder="e.g. Company press release" className={`${input} mt-1`} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">Source link
              <input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://…" className={`${input} mt-1`} />
            </label>
          </div>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-60">{busy ? "Saving…" : editId ? "Save changes" : "Add milestone"}</button>
            <button type="button" onClick={() => { setForm(null); setEditId(null); setError(null); }} className={btn}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-8 px-5 pt-5 lg:grid-cols-2">
        {view !== "past" && (
          <div className={view === "upcoming" ? "lg:col-span-2" : ""}>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Upcoming</h3>
            {upcoming.length === 0
              ? <p className="pb-5 text-sm text-slate-400">No upcoming milestones recorded.</p>
              : <ol>{upcoming.map((m, i) => row(m, i, upcoming))}</ol>}
          </div>
        )}
        {view !== "upcoming" && (
          <div className={view === "past" ? "lg:col-span-2" : ""}>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Past — newest first</h3>
            {past.length === 0
              ? <p className="pb-5 text-sm text-slate-400">Nothing recorded yet.</p>
              : <ol>{pastShown.map((m, i) => row(m, i, pastShown))}</ol>}
            {past.length > 6 && (
              <button type="button" className={`${linkBtn} mb-5`} onClick={() => setShowAllPast(!showAllPast)}>
                {showAllPast ? "Show fewer" : `Show all ${past.length}`}
              </button>
            )}
          </div>
        )}
      </div>
      {!readOnly && hiddenCount > 0 && (
        <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          {hiddenCount} hidden research row{hiddenCount === 1 ? "" : "s"} · <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Hide them again" : "Show them"}</button>
        </div>
      )}
      {error && !form && <p className="px-5 pb-3 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}

// --------------------------------------------------------------------------- #
// Results
// --------------------------------------------------------------------------- #

type RForm = Record<"trial" | "phase" | "population" | "duration" | "dose" | "endpoint" | "result" | "comparator" | "reported" | "source_label" | "source_url", string> & { kind: "efficacy" | "safety" };
const emptyR = (kind: "efficacy" | "safety"): RForm => ({ kind, trial: "", phase: "", population: "", duration: "", dose: "", endpoint: "", result: "", comparator: "", reported: "", source_label: "", source_url: "" });

export function ResultsCard({ slug, results, readOnly }: { slug: string; results: ProductResult[]; readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"efficacy" | "safety">("efficacy");
  const [showHidden, setShowHidden] = useState(false);
  const [form, setForm] = useState<RForm | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const visible = results.filter((r) => showHidden || !r.hidden);
  const counts = { efficacy: visible.filter((r) => r.kind === "efficacy").length, safety: visible.filter((r) => r.kind === "safety").length };
  const rows = visible.filter((r) => r.kind === tab);
  const hiddenCount = results.filter((r) => r.hidden).length;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  }
  async function save() {
    if (!form) return;
    const ok = await run(() => send(slug, editId ? "PATCH" : "POST", { type: "result", ...(editId ? { id: editId } : {}), ...form }));
    if (ok) { setForm(null); setEditId(null); setTab(form.kind); }
  }
  const edit = (r: ProductResult) => {
    setEditId(r.id);
    setForm({ kind: r.kind, trial: r.trial ?? "", phase: r.phase ?? "", population: r.population ?? "", duration: r.duration ?? "", dose: r.dose ?? "",
      endpoint: r.endpoint ?? "", result: r.result, comparator: r.comparator ?? "", reported: r.reported ?? "", source_label: r.source_label ?? "", source_url: r.source_url ?? "" });
  };
  const f = (k: keyof RForm, label: string, ph: string, span = "") => (
    <label className={`text-xs text-slate-500 ${span}`}>{label}
      <input value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} placeholder={ph} className={`${input} mt-1`} />
    </label>
  );

  return (
    <Card
      id="results"
      title="Efficacy & safety results"
      sub="Key trial results with the comparator and source. Percentages are change from baseline unless the row says otherwise."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {(["efficacy", "safety"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                      className={`rounded-md px-2.5 py-1 capitalize transition ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                {k} ({counts[k]})
              </button>
            ))}
          </div>
          {!readOnly && <button type="button" className={btn} onClick={() => { setEditId(null); setForm(emptyR(tab)); }}>+ Add result</button>}
        </div>
      }
    >
      {form && (
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-xs text-slate-500">Type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as RForm["kind"] })} className={`${input} mt-1`}>
                <option value="efficacy">Efficacy</option>
                <option value="safety">Safety</option>
              </select>
            </label>
            {f("trial", "Trial", "e.g. SURMOUNT-1")}
            {f("phase", "Phase", "e.g. Phase 3")}
            {f("reported", "Reported", "e.g. 2026-05")}
            {f("population", "Population", "e.g. 2,539 adults with obesity", "sm:col-span-2")}
            {f("duration", "Duration", "e.g. 72 weeks")}
            {f("dose", "Dose", "e.g. 15 mg weekly")}
            {f("endpoint", "Endpoint", "e.g. Body weight change", "sm:col-span-2")}
            {f("result", "Result", "e.g. −20.9%", "sm:col-span-2")}
            {f("comparator", "Comparator", "e.g. Placebo −3.1%", "sm:col-span-2")}
            {f("source_label", "Source name", "e.g. NEJM 2022")}
            {f("source_url", "Source link", "https://…")}
          </div>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-60">{busy ? "Saving…" : editId ? "Save changes" : "Add result"}</button>
            <button type="button" onClick={() => { setForm(null); setEditId(null); setError(null); }} className={btn}>Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No {tab} results recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-5 py-2.5 font-semibold">Trial</th>
                <th className="px-3 py-2.5 font-semibold">Population · duration</th>
                <th className="px-3 py-2.5 font-semibold">Dose</th>
                <th className="px-3 py-2.5 font-semibold">{tab === "efficacy" ? "Endpoint" : "Measure"}</th>
                <th className="px-3 py-2.5 font-semibold">Result</th>
                <th className="px-3 py-2.5 font-semibold">Comparator</th>
                <th className="px-5 py-2.5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {rows.map((r) => (
                <tr key={r.id} className={r.hidden ? "opacity-50" : ""}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{r.trial ?? "—"}</div>
                    <div className="text-xs text-slate-500">{[r.phase, r.reported ? dateText(r.reported) : null].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {r.population ?? <span className="text-slate-300">—</span>}
                    {r.duration && <div className="text-xs text-slate-500">{r.duration}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{r.dose ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-slate-700">{r.endpoint ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{r.result}</td>
                  <td className="px-3 py-3 text-slate-600">{r.comparator ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-3 text-xs">
                    <SourceLink label={r.source_label} url={r.source_url} />
                    {!readOnly && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Origin origin={r.origin} />
                        {r.origin === "manual" ? (
                          <>
                            <button type="button" className={linkBtn} onClick={() => edit(r)}>Edit</button>
                            <button type="button" className="text-xs font-medium text-rose-600 hover:underline" disabled={busy}
                                    onClick={() => { if (confirmDel !== r.id) { setConfirmDel(r.id); return; } setConfirmDel(null); run(() => send(slug, "DELETE", undefined, `type=result&id=${r.id}`)); }}>
                              {confirmDel === r.id ? "Click again" : "Delete"}
                            </button>
                          </>
                        ) : (
                          <button type="button" className={linkBtn} disabled={busy} onClick={() => run(() => send(slug, "PATCH", { type: "result", id: r.id, hidden: !r.hidden }))}>
                            {r.hidden ? "Show" : "Hide"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && hiddenCount > 0 && (
        <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          {hiddenCount} hidden research row{hiddenCount === 1 ? "" : "s"} · <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Hide them again" : "Show them"}</button>
        </div>
      )}
      {error && !form && <p className="px-5 pb-3 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
