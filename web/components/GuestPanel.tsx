"use client";

import { useCallback, useEffect, useState } from "react";
import type { Guest } from "@/lib/guests";

// Admin page: temporary view-only logins for testers and prospects.

// Minutes → label. Short ones for a quick look during a call, long ones for a trial.
const DURATIONS: [number, string][] = [
  [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"],
  [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [480, "8 hours"],
  [1440, "1 day"], [4320, "3 days"], [10080, "7 days"], [20160, "14 days"], [43200, "30 days"],
];

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min left`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} left`;
  return `${Math.round(h / 24)} days left`;
}

const STATUS = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  expired: "bg-slate-100 text-slate-600 ring-slate-200",
  revoked: "bg-rose-50 text-rose-700 ring-rose-200",
} as const;

export default function GuestPanel() {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [minutes, setMinutes] = useState(10080);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ guest: Guest; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/guests", { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setGuests(body.guests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
    // Keep "min left" and expiries current while the page is open.
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, username: username || undefined, minutes }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setCreated(body);
      setLabel("");
      setUsername("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: number, action: "revoke" | "extend", m = 60) {
    setError(null);
    setConfirmRevoke(null);
    try {
      const r = await fetch("/api/guests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, minutes: m }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const details = created
    ? [
        "Obesity Trials Intelligence — guest access",
        `Sign in at: ${window.location.origin}/login`,
        `Username: ${created.guest.username}`,
        `Password: ${created.password}`,
        `Valid until: ${fmt(created.guest.expires_at)}`,
      ].join("\n")
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Guest access</h2>
        <p className="text-xs text-slate-500">
          Temporary, view-only logins for testers and prospects. Guests can browse Trials, Drugs and Changes and open trial pages.
          They can&apos;t edit or merge drugs, see Data quality or open this Admin page. Access ends by itself at the end time (from 10 minutes to 30 days), and you can revoke it at any time.
        </p>
      </div>

      <form onSubmit={create} className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          Who is it for?
          <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120}
                 placeholder="e.g. Rahul – CI team, Acme Pharma" className={input} />
        </label>
        <label className="flex w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Username <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30}
                 placeholder="made up for you" className={input} />
        </label>
        <label className="flex w-[150px] flex-col gap-1 text-xs font-medium text-slate-600">
          Access for
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={input}>
            {DURATIONS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Creating…" : "Create guest login"}
        </button>
      </form>

      {created && (
        <div className="mx-5 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-emerald-800">Guest login created for {created.guest.label}</span>
            <div className="flex gap-2">
              <button type="button" onClick={copy}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-300 hover:bg-emerald-100">
                {copied ? "Copied ✓" : "Copy login details"}
              </button>
              <button type="button" onClick={() => setCreated(null)} className="rounded-md px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100">
                Done
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-[13px] text-slate-800 ring-1 ring-emerald-200">{details}</pre>
          <p className="mt-2 text-xs text-emerald-800">Send these to them now — the password is shown only once. If it&apos;s lost, revoke this login and create a new one.</p>
        </div>
      )}

      {error && <p className="mx-5 mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 font-semibold">Username</th>
              <th className="px-3 py-2 font-semibold">For</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Access until</th>
              <th className="px-3 py-2 font-semibold">Last sign-in</th>
              <th className="px-5 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!guests ? (
              <tr><td colSpan={6} className="px-5 py-5 text-center text-slate-400">{error ? "—" : "Loading…"}</td></tr>
            ) : guests.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-5 text-center text-slate-400">No guest logins yet.</td></tr>
            ) : guests.map((g) => (
              <tr key={g.id} className={g.status === "active" ? "" : "text-slate-500"}>
                <td className="px-5 py-2.5 font-mono text-[13px] font-medium text-slate-800">{g.username}</td>
                <td className="px-3 py-2.5">{g.label}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${STATUS[g.status]}`}>
                    {g.status === "active" ? timeLeft(g.expires_at) : g.status === "expired" ? "Expired" : "Revoked"}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums">{g.status === "revoked" ? `revoked ${fmt(g.revoked_at)}` : fmt(g.expires_at)}</td>
                <td className="px-3 py-2.5 tabular-nums">
                  {g.last_login_at ? <>{fmt(g.last_login_at)} <span className="text-xs text-slate-400">({g.login_count}×)</span></> : <span className="text-slate-400">never</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  {g.status !== "active" && <span className="mr-1 text-xs text-slate-400">Re-open:</span>}
                  <button type="button" onClick={() => act(g.id, "extend", 30)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                    +30 min
                  </button>
                  <button type="button" onClick={() => act(g.id, "extend", 1440)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                    +1 day
                  </button>
                  <button type="button" onClick={() => act(g.id, "extend", 10080)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                    +7 days
                  </button>
                  {g.status === "active" && (confirmRevoke === g.id ? (
                    <>
                      <button type="button" onClick={() => act(g.id, "revoke")}
                              className="ml-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700">
                        Confirm revoke
                      </button>
                      <button type="button" onClick={() => setConfirmRevoke(null)} className="ml-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmRevoke(g.id)}
                            className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">
                      Revoke
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
