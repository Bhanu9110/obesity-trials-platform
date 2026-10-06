"use client";

import { useCallback, useEffect, useState } from "react";
import { NctLink } from "@/components/ui";
import AccessPanel from "@/components/AccessPanel";
import UsersPanel from "@/components/UsersPanel";

interface SyncRun {
  id: string;
  run_at: string;
  status: string;
  mode: string | null;
  trials_fetched: number | null;
  trials_upserted: number | null;
  trials_unchanged: number | null;
  trials_filtered: number | null;
  trials_failed: number | null;
  duration_ms: number | null;
  error_detail: any;
}
interface Failure {
  nct_id: string;
  status: "pending" | "dead";
  failure_type: string;
  error_msg: string;
  attempts: number;
  last_attempted: string | null;
  next_attempt_at: string | null;
}
interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}
interface Dashboard {
  health: { status: "ok" | "warn" | "fail"; checks: Check[] };
  runs: SyncRun[];
  failures: Failure[];
  counts: { trials: number; storedTrials: number; noDrug: number; products: number; productsWithInfo: number };
  classes: { name: string; trials: number }[];
  lastSuccessfulSync: string | null;
  sync: { configured: boolean; actionsUrl: string | null };
}

const STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-600",
  partial: "text-amber-600",
  failed: "text-rose-600",
  running: "text-sky-600",
};
const CHECK_STYLE = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  fail: "bg-rose-50 text-rose-700",
} as const;
const CHECK_TEXT = { ok: "OK", warn: "Check", fail: "Problem" } as const;

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

export default function AdminPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; url?: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/sync", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => (d.error ? setError(d.error) : (setError(null), setData(d))))
        .catch((e) => setError(String(e))),
    [],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function startSync(full: boolean) {
    if (full && !window.confirm("Start a FULL re-download of every trial? It takes a few minutes.")) return;
    setBusy(full ? "full" : "daily");
    setNotice(null);
    try {
      const r = await fetch(`/api/sync${full ? "?full=true" : ""}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setNotice({ ok: true, text: `${full ? "Full re-download" : "Daily update"} started on GitHub. It appears below as a new run in a minute or two.`, url: body.url });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function failureAction(nct_id: string, action: "requeue" | "dismiss") {
    setBusy(`${action}:${nct_id}`);
    try {
      const r = await fetch("/api/failures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nct_id, action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        <UsersPanel />
        <AccessPanel />
      </div>
    );
  }
  if (!data) return <div className="text-sm text-slate-400">Loading pipeline health…</div>;

  const dead = data.failures.filter((f) => f.status === "dead");
  const pending = data.failures.filter((f) => f.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow mb-2 flex items-center gap-2">
            <span className="h-px w-6 bg-gradient-to-r from-transparent to-brand-500" /> Control centre
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
            Pipeline <span className="text-gradient">dashboard</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Last successful sync: {when(data.lastSuccessfulSync)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => startSync(false)}
            disabled={busy !== null}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === "daily" ? "Starting…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={() => startSync(true)}
            disabled={busy !== null}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "full" ? "Starting…" : "Full re-download"}
          </button>
          {data.sync.actionsUrl && (
            <a href={data.sync.actionsUrl} target="_blank" rel="noreferrer"
               className="rounded-lg px-3 py-2 text-sm text-brand-600 hover:underline">
              GitHub runs ↗
            </a>
          )}
        </div>
      </div>

      {!data.sync.configured && !notice && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          The Sync buttons need one setting on the website: <code>GITHUB_DISPATCH_TOKEN</code> (see DEPLOY.md). Until then,
          start a sync from GitHub → Actions → Daily CT.gov sync → Run workflow.
        </p>
      )}
      {notice && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {notice.text}{" "}
          {notice.url && <a href={notice.url} target="_blank" rel="noreferrer" className="underline">Open on GitHub ↗</a>}
        </div>
      )}

      {/* Health */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Health</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHECK_STYLE[data.health.status]}`}>
            {data.health.status === "ok" ? "All good" : data.health.status === "warn" ? "Needs a look" : "Problem"}
          </span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.health.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${CHECK_STYLE[c.status]}`}>
                {CHECK_TEXT[c.status]}
              </span>
              <span>
                <span className="font-medium capitalize text-slate-800">{c.name}</span>{" "}
                <span className="text-slate-500">— {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Primary-obesity trials (shown)" value={data.counts.trials} color="text-slate-800" />
        <Tile label="Drugs" value={data.counts.products} color="text-slate-800" />
        <Tile label="Drugs with product info" value={data.counts.productsWithInfo} color="text-emerald-600" />
        <Tile label="Drugs still blank" value={data.counts.products - data.counts.productsWithInfo} color="text-amber-600" />
      </div>

      <p className="text-xs text-slate-500">
        Stored: only <b>primary-obesity</b> trials that name a drug or a drug class
        — obesity must be the lead (first-listed) condition; industry trials of weight-loss drugs in people with obesity
        are also kept. Trials where another disease leads and obesity is only a comorbidity, weight-related trials,
        non-obesity trials and trials naming no drug are
        not stored — the “Excluded” column below counts them per run.
      </p>

      {/* Dead-letter queue */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Dead-letter queue ({dead.length})</h2>
        <p className="mb-3 text-xs text-slate-500">
          Records that failed several times in a row. Re-queue to try again on the next run, or dismiss.
        </p>
        {dead.length === 0 ? (
          <p className="text-sm text-emerald-600">Empty.</p>
        ) : (
          <FailureTable rows={dead} busy={busy} onAction={failureAction} />
        )}
      </section>

      {/* Retry queue */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Retry queue ({pending.length})</h2>
        <p className="mb-3 text-xs text-slate-500">Failed records that are retried automatically on later runs.</p>
        {pending.length === 0 ? (
          <p className="text-sm text-emerald-600">Nothing waiting.</p>
        ) : (
          <FailureTable rows={pending} busy={busy} onAction={failureAction} />
        )}
      </section>

      {/* Runs */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent sync runs</h2>
        {data.runs.length === 0 ? (
          <p className="text-sm text-slate-400">No sync runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Fetched</th>
                  <th className="pb-2 text-right font-medium">Written</th>
                  <th className="pb-2 text-right font-medium">Unchanged</th>
                  <th className="pb-2 text-right font-medium" title="Not primary obesity, or no drug named — not stored">Excluded</th>
                  <th className="pb-2 text-right font-medium">Failed</th>
                  <th className="pb-2 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100" title={r.error_detail ? JSON.stringify(r.error_detail).slice(0, 500) : undefined}>
                    <td className="py-2">{when(r.run_at)}</td>
                    <td className="py-2 text-slate-500">{r.mode ?? "—"}</td>
                    <td className={`py-2 font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</td>
                    <td className="py-2 text-right tabular-nums">{r.trials_fetched ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.trials_upserted ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.trials_unchanged ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.trials_filtered ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.trials_failed ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Health check for uptime monitors: <code>/api/health</code> (no login needed).
        </p>
      </section>

      <UsersPanel />
      <AccessPanel />
    </div>
  );
}

function FailureTable({
  rows,
  busy,
  onAction,
}: {
  rows: Failure[];
  busy: string | null;
  onAction: (id: string, a: "requeue" | "dismiss") => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-slate-400">
          <tr>
            <th className="pb-2 font-medium">Trial</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Error</th>
            <th className="pb-2 text-right font-medium">Attempts</th>
            <th className="pb-2 pl-4 font-medium">Next try</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {rows.map((f) => (
            <tr key={f.nct_id} className="border-t border-slate-100 align-top">
              <td className="py-2">{/^NCT\d{8}$/.test(f.nct_id) ? <NctLink id={f.nct_id} /> : <span className="font-mono text-xs">{f.nct_id}</span>}</td>
              <td className="py-2">{f.failure_type}</td>
              <td className="max-w-md py-2 pr-4 text-rose-600">{f.error_msg}</td>
              <td className="py-2 text-right tabular-nums">{f.attempts}</td>
              <td className="py-2 pl-4 text-slate-500">{f.status === "dead" ? "—" : when(f.next_attempt_at)}</td>
              <td className="whitespace-nowrap py-2 text-right">
                <button type="button" disabled={busy !== null} onClick={() => onAction(f.nct_id, "requeue")}
                        className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-slate-100 disabled:opacity-50">
                  {f.status === "dead" ? "Re-queue" : "Retry next run"}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => onAction(f.nct_id, "dismiss")}
                        className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                  Dismiss
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
