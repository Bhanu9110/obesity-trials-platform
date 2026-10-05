"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccessEventRow, AccessMember } from "@/app/api/access/route";

// Admin page: who uses the website. Members (from AUTH_USERS) with their last
// sign-in, activity and location, plus a log of recent sign-ins, page views and
// failed sign-in attempts. Only admins (ADMIN_USERS) can load it.

type Kind = "" | "logins" | "failed";

const EVENT_STYLE: Record<string, { label: string; style: string }> = {
  login: { label: "Signed in", style: "bg-emerald-50 text-emerald-700" },
  logout: { label: "Signed out", style: "bg-slate-100 text-slate-600" },
  page: { label: "Viewed", style: "bg-sky-50 text-sky-700" },
  login_failed: { label: "Failed sign-in", style: "bg-rose-50 text-rose-700" },
  blocked: { label: "Blocked", style: "bg-rose-100 text-rose-800" },
};

/** "Chrome on Windows" from a user-agent string. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|python|bot|spider|crawl/i.test(ua) ? "Script / bot" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const ROLE_TAG = {
  owner: { label: "owner", style: "bg-violet-50 text-violet-700 ring-violet-200" },
  member: { label: "member", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  guest: { label: "guest", style: "bg-sky-50 text-sky-700 ring-sky-200" },
} as const;

const flag = (cc: string) =>
  /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

export default function AccessPanel() {
  const [kind, setKind] = useState<Kind>("");
  const [data, setData] = useState<{ members: AccessMember[]; events: AccessEventRow[]; failed7d: { attempts: number; ips: number }; timeZone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/access${kind ? `?kind=${kind}` : ""}`, { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [kind]);

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  async function remove(username: string) {
    if (confirmRemove !== username) { setConfirmRemove(username); return; }
    setConfirmRemove(null);
    const r = await fetch(`/api/access?username=${encodeURIComponent(username)}`, { method: "DELETE" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) setError(body.error ?? `HTTP ${r.status}`);
    load();
  }

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Who is using the website</h2>
          <p className="text-xs text-slate-500">
            Every sign-in, failed sign-in attempt and page view, with approximate location. Kept for 180 days; only admins can see this.
            {data && <> Times in {data.timeZone}.</>}
          </p>
        </div>
        {data && data.failed7d.attempts > 0 && (
          <button type="button" onClick={() => setKind("failed")}
                  className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
            {data.failed7d.attempts} failed sign-in attempt{data.failed7d.attempts === 1 ? "" : "s"} from {data.failed7d.ips} address{data.failed7d.ips === 1 ? "" : "es"} in 7 days
          </button>
        )}
      </div>

      {error ? (
        <p className="px-5 py-4 text-sm text-slate-500">{error}</p>
      ) : !data ? (
        <p className="px-5 py-4 text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Last active</th>
                  <th className="px-3 py-2 font-semibold">Last sign-in</th>
                  <th className="px-3 py-2 text-right font-semibold">Sign-ins (30 d)</th>
                  <th className="px-3 py-2 text-right font-semibold">Pages (30 d)</th>
                  <th className="px-3 py-2 font-semibold">Last location</th>
                  <th className="px-5 py-2 font-semibold">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.members.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-6 text-center text-slate-400">No activity recorded yet.</td></tr>
                ) : data.members.map((m) => (
                  <tr key={m.username} className={m.allowed ? "" : "bg-amber-50/50"}>
                    <td className="px-5 py-2.5 font-medium text-slate-800">
                      {m.username.replace(/^(guest|user):/, "")}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${ROLE_TAG[m.role].style}`}>{ROLE_TAG[m.role].label}</span>
                      {!m.allowed && (
                        <>
                          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600" title="Can no longer sign in">
                            no access
                          </span>
                          <button type="button" onClick={() => remove(m.username)}
                                  className="ml-2 text-[11px] font-medium text-rose-700 hover:underline" title="Remove from this list (deletes their activity history)">
                            {confirmRemove === m.username ? "Click again to remove" : "Remove"}
                          </button>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{m.last_seen ?? <span className="text-slate-400">never</span>}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{m.last_login ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.logins_30d}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{m.pages_30d}</td>
                    <td className="px-3 py-2.5 text-slate-700" title={m.last_ip ?? undefined}>
                      {m.last_place || <span className="text-slate-400">—</span>}
                      {m.countries.length > 1 && <span className="ml-1 text-xs text-slate-400">({m.countries.length} countries)</span>}
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{device(m.last_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 bg-slate-50 px-5 py-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Recent activity</span>
            {([["", "Everything"], ["logins", "Sign-ins only"], ["failed", "Failed attempts"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                      className={`rounded-full px-2.5 py-1 ${kind === k ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {data.events.length === 0 ? (
                  <tr><td className="px-5 py-6 text-center text-slate-400">Nothing recorded yet.</td></tr>
                ) : data.events.map((e) => {
                  const st = EVENT_STYLE[e.event] ?? { label: e.event, style: "bg-slate-100 text-slate-600" };
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-slate-500">{e.at}</td>
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.style}`}>{st.label}</span></td>
                      <td className="px-3 py-2 font-medium text-slate-800">{e.username ? e.username.replace(/^(guest|user):/, "") : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{e.event === "page" ? e.path : ""}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {e.place ? <>{flag((e.place.split(", ").pop() ?? "").trim())} {e.place}</> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.ip ?? ""}</td>
                      <td className="px-5 py-2 text-slate-500">{device(e.user_agent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-slate-500">
            Manage who can get in under Users &amp; access above. Owner accounts are set in Vercel (<code className="rounded bg-slate-100 px-1">AUTH_USERS</code>).
            Locations come from the visitor&apos;s IP address and are approximate.
          </p>
        </>
      )}
    </section>
  );
}
