"use client";

import { useEffect, useState } from "react";

interface SyncRun {
  id: string;
  run_at: string;
  status: string;
  trials_fetched: number;
  trials_upserted: number;
  trials_failed: number;
  api_pages_consumed: number;
  duration_ms: number;
}
interface Failure {
  nct_id: string;
  failure_type: string;
  error_msg: string;
  retry_count: number;
  last_attempted: string;
}
interface Dashboard {
  runs: SyncRun[];
  failures: Failure[];
  counts: { trials: number; products: number; productsWithInfo: number };
  lastSuccessfulSync: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-600",
  partial: "text-amber-600",
  failed: "text-rose-600",
  running: "text-sky-600",
};

export default function AdminPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/sync")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  }
  if (!data) return <div className="text-sm text-slate-400">Loading pipeline health…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Pipeline dashboard</h1>
        <p className="text-sm text-slate-500">
          Last successful sync:{" "}
          {data.lastSuccessfulSync
            ? new Date(data.lastSuccessfulSync).toLocaleString()
            : "never"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Trials" value={data.counts.trials} color="text-slate-800" />
        <Tile label="Drugs" value={data.counts.products} color="text-slate-800" />
        <Tile label="Drugs with product info" value={data.counts.productsWithInfo} color="text-emerald-600" />
        <Tile label="Drugs still blank" value={data.counts.products - data.counts.productsWithInfo} color="text-amber-600" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent sync runs</h2>
        {data.runs.length === 0 ? (
          <p className="text-sm text-slate-400">No sync runs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Fetched</th>
                <th className="pb-2 font-medium">Upserted</th>
                <th className="pb-2 font-medium">Failed</th>
                <th className="pb-2 font-medium">Pages</th>
                <th className="pb-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {data.runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2">{new Date(r.run_at).toLocaleString()}</td>
                  <td className={`py-2 font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</td>
                  <td className="py-2">{r.trials_fetched}</td>
                  <td className="py-2">{r.trials_upserted}</td>
                  <td className="py-2">{r.trials_failed}</td>
                  <td className="py-2">{r.api_pages_consumed}</td>
                  <td className="py-2">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Open sync failures ({data.failures.length})
        </h2>
        {data.failures.length === 0 ? (
          <p className="text-sm text-emerald-600">No unresolved failures.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="pb-2 font-medium">NCT</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Error</th>
                <th className="pb-2 font-medium">Retries</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {data.failures.map((f, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs">{f.nct_id}</td>
                  <td className="py-2">{f.failure_type}</td>
                  <td className="py-2 text-rose-600">{f.error_msg}</td>
                  <td className="py-2">{f.retry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
