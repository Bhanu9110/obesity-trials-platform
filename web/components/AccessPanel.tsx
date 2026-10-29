"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccessEventRow, AccessKind, AccessMember, AccessResponse } from "@/app/api/access/route";
import { StatTile } from "@/components/PageHeader";
import { icons } from "@/components/shell/icons";

// Audit logs page body: headline numbers, a 14-day activity chart, the most opened
// pages, everyone who can (or could) sign in, and the full activity log — filterable
// by type, person and text, grouped by day, with older entries on demand and a CSV
// export. Refreshes itself every 30 seconds. Admins and the super admin only.

// --------------------------------------------------------------------------- #
// Formatting helpers
// --------------------------------------------------------------------------- #

const EVENT: Record<string, { label: string; dot: string; chip: string; icon: ReactNode }> = {
  login: { label: "Signed in", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: icons.profile },
  logout: { label: "Signed out", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", icon: icons.logout },
  page: { label: "Viewed", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200", icon: icons.link },
  login_failed: { label: "Failed sign-in", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200", icon: icons.close },
  blocked: { label: "Blocked", dot: "bg-rose-600", chip: "bg-rose-100 text-rose-800 ring-rose-300", icon: icons.close },
  user_added: { label: "Login added", dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700 ring-violet-200", icon: icons.plus },
  user_changed: { label: "Login changed", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200", icon: icons.users },
  user_removed: { label: "Login removed", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200", icon: icons.users },
  password_changed: { label: "Password changed", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", icon: icons.admin },
  export: { label: "Downloaded data", dot: "bg-teal-500", chip: "bg-teal-50 text-teal-700 ring-teal-200", icon: icons.link },
};
const eventStyle = (e: string) => EVENT[e] ?? { label: e, dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", icon: icons.clock };

const ROLE: Record<AccessMember["role"], { label: string; chip: string; avatar: string }> = {
  super_admin: { label: "Super admin", chip: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200", avatar: "from-fuchsia-500 to-violet-500" },
  owner: { label: "Owner", chip: "bg-violet-50 text-violet-700 ring-violet-200", avatar: "from-violet-500 to-indigo-500" },
  admin: { label: "Admin", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200", avatar: "from-indigo-500 to-sky-500" },
  member: { label: "Member", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", avatar: "from-emerald-500 to-teal-500" },
  guest: { label: "Guest", chip: "bg-sky-50 text-sky-700 ring-sky-200", avatar: "from-sky-500 to-cyan-500" },
};

const TABS: [AccessKind, string][] = [
  ["all", "Everything"], ["logins", "Sign-ins"], ["pages", "Page views"], ["failed", "Failed attempts"], ["admin", "Admin actions"], ["exports", "Downloads"],
];

const plain = (u: string) => u.replace(/^(guest|user|admin):/, "");

function initials(name: string): string {
  const w = name.trim().split(/[\s._-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** "Chrome · Windows" from a user-agent string. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|python|bot|spider|crawl|wget|go-http/i.test(ua) ? "Script / bot" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

const flag = (cc: string | null) =>
  cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

function ago(s: number | null): string {
  if (s === null || s === undefined) return "Never";
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "Yesterday" : d < 30 ? `${d} days ago` : `${Math.floor(d / 30)} mo ago`;
}

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
function dayHeading(day: string, today: string): string {
  const diff = Math.round((dayDate(today).getTime() - dayDate(day).getTime()) / 86400000);
  const long = dayDate(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return diff === 0 ? `Today · ${long}` : diff === 1 ? `Yesterday · ${long}` : long;
}

/** A page path as people know it: "Drug · Semaglutide", "Trial · NCT05822830". */
function pageLabel(path: string | null): { label: string; href?: string } {
  if (!path) return { label: "—" };
  const p = path.split("?")[0];
  const fixed: Record<string, string> = {
    "/": "Overview", "/trials": "Trials explorer", "/drugs": "Drugs", "/changes": "Registry changes", "/quality": "Data quality",
    "/admin": "Admin", "/audit-logs": "Audit logs", "/profile": "Profile", "/help": "Help & manual",
  };
  if (fixed[p]) return { label: fixed[p], href: p };
  let m = p.match(/^\/drugs\/([^/]+)/);
  if (m) {
    const name = decodeURIComponent(m[1]).replace(/-/g, " ");
    return { label: `Drug · ${/\d/.test(name) ? name.toUpperCase() : name.replace(/^\w/, (c) => c.toUpperCase())}`, href: p };
  }
  m = p.match(/^\/trials\/(NCT\d+)/i);
  if (m) return { label: `Trial · ${m[1].toUpperCase()}`, href: p };
  return { label: p };
}

const ACTION_TEXT: Record<string, string> = {
  revoke: "revoked access for", extend: "extended access for", set_end: "changed the end date for", no_end: "removed the end date for",
  pages: "changed the pages of", label: "renamed", password: "set a new password for",
  "export on": "allowed data downloads for", "export off": "stopped data downloads for",
};

/** One log entry as a sentence. */
function describe(e: AccessEventRow, nameOf: (u: string) => string): ReactNode {
  const who = e.username ? <b className="font-semibold text-slate-900">{nameOf(e.username)}</b> : <span className="text-slate-500">Someone</span>;
  const d = e.detail ?? "";
  switch (e.event) {
    case "page": {
      const pg = pageLabel(e.path);
      return <>{who} opened {pg.href ? <Link href={pg.href} className="font-medium text-brand-600 hover:underline">{pg.label}</Link> : <span className="font-mono text-xs">{pg.label}</span>}</>;
    }
    case "login": return <>{who} signed in</>;
    case "logout": return <>{who} signed out</>;
    case "login_failed": return <>Failed sign-in as {who} <span className="text-slate-500">— wrong username or password</span></>;
    case "blocked": return <>Sign-in as {who} was blocked <span className="text-slate-500">— too many failed attempts from this network</span></>;
    case "user_added": {
      const [role, name] = d.split(" ");
      return <>{who} added {role === "admin" ? "an" : "a"} <b className="font-semibold text-slate-900">{role}</b> login <b className="font-semibold text-slate-900">{name ?? ""}</b></>;
    }
    case "user_removed": {
      const [role, name] = d.split(" ");
      return <>{who} removed the {role} login <b className="font-semibold text-slate-900">{name ?? ""}</b></>;
    }
    case "user_changed":
    case "password_changed": {
      if (d === "changed own password") return <>{who} changed their own password</>;
      const i = d.indexOf(": ");
      if (i < 0) return <>{who} {e.event === "password_changed" ? "changed a password" : "changed a login"}{d && <span className="text-slate-500"> — {d}</span>}</>;
      const target = <b className="font-semibold text-slate-900">{d.slice(0, i)}</b>;
      const what = d.slice(i + 2);
      if (what.startsWith("role")) return <>{who} changed the role of {target} <span className="text-slate-500">({what.replace(/^role\s*→\s*/, "now ")})</span></>;
      return <>{who} {ACTION_TEXT[what] ?? `changed (${what})`} {target}</>;
    }
    case "export": return <>{who} downloaded <span className="text-slate-700">{d || "data"}</span></>;
    default: return <>{who} <span className="text-slate-500">{e.event}</span></>;
  }
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// --------------------------------------------------------------------------- #
// Small building blocks
// --------------------------------------------------------------------------- #

function Card({ title, sub, right, children, className = "", bodyClass = "p-5" }: {
  title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-slate-950">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

function Avatar({ name, role, online }: { name: string; role: AccessMember["role"]; online?: boolean }) {
  return (
    <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${ROLE[role].avatar} text-xs font-semibold text-white`}>
      {initials(name)}
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" title="Active in the last 5 minutes" />}
    </span>
  );
}

function RoleChip({ role }: { role: AccessMember["role"] }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ROLE[role].chip}`}>{ROLE[role].label}</span>;
}

/** Page views and sign-ins per day for the last 14 days; failed attempts as a red count above the day. */
function DailyChart({ daily, today }: { daily: AccessResponse["daily"]; today: string }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.pages, d.logins)));
  const step = max <= 5 ? 1 : Math.ceil(max / 4 / 5) * 5;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).reverse();
  return (
    <div>
      <div className="relative flex h-72 gap-3">
        <div className="flex w-7 flex-col justify-between text-right text-[10px] tabular-nums text-slate-400">
          {grid.map((g) => <span key={g} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">{g}</span>)}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {grid.map((g) => <div key={g} className="border-t border-dashed border-slate-200/80" />)}
          </div>
          <div className="relative flex h-full items-end gap-1 sm:gap-2">
            {daily.map((d) => {
              const label = dayDate(d.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
              return (
                <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center gap-[3px]"
                     title={`${label}: ${d.pages} page views, ${d.logins} sign-ins${d.failed ? `, ${d.failed} failed` : ""}`}>
                  {d.failed > 0 && (
                    <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-rose-500 px-1.5 text-[9px] font-semibold leading-4 text-white">{d.failed}</span>
                  )}
                  <div className="w-full max-w-[14px] rounded-t-[3px] bg-brand-500/85 transition group-hover:bg-brand-500" style={{ height: `${(d.pages / top) * 100}%`, minHeight: d.pages ? 2 : 0 }} />
                  <div className="w-full max-w-[14px] rounded-t-[3px] bg-accent-500/80 transition group-hover:bg-accent-500" style={{ height: `${(d.logins / top) * 100}%`, minHeight: d.logins ? 2 : 0 }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-10 mt-2 flex gap-1 sm:gap-2">
        {daily.map((d, i) => (
          <div key={d.day} className={`flex-1 text-center text-[10px] tabular-nums ${d.day === today ? "font-semibold text-slate-900" : "text-slate-400"}`}>
            {i % 2 === daily.length % 2 || d.day === today
              ? dayDate(d.day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
              : ""}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />Page views</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-500" />Sign-ins</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Failed attempts</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- #
// The panel
// --------------------------------------------------------------------------- #

export default function AccessPanel() {
  const [kind, setKind] = useState<AccessKind>("all");
  const [who, setWho] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [peopleQ, setPeopleQ] = useState("");
  const [data, setData] = useState<AccessResponse | null>(null);
  const [events, setEvents] = useState<AccessEventRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [extraPages, setExtraPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const extraRef = useRef(0);
  extraRef.current = extraPages;

  // Typing in the log search waits a moment before asking the server.
  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);

  const url = useCallback((before?: number) => {
    const p = new URLSearchParams();
    if (kind !== "all") p.set("kind", kind);
    if (who) p.set("user", who);
    if (q) p.set("q", q);
    if (before) p.set("before", String(before));
    const qs = p.toString();
    return `/api/access${qs ? `?${qs}` : ""}`;
  }, [kind, who, q]);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const r = await fetch(url(), { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setData(body);
      // A background refresh keeps older entries you loaded; it only updates the numbers and adds new entries on top.
      if (background && extraRef.current > 0) {
        setEvents((old) => {
          const shown = new Set(old.map((e) => e.id));
          return [...(body as AccessResponse).events.filter((e) => !shown.has(e.id) && e.at >= (old[0]?.at ?? "")), ...old];
        });
      } else {
        setEvents(body.events);
        setHasMore(body.hasMore);
        setExtraPages(0);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function loadMore() {
    const last = events[events.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await fetch(url(last.id), { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setEvents((old) => [...old, ...(body as AccessResponse).events]);
      setHasMore(body.hasMore);
      setExtraPages((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(username: string) {
    if (confirmRemove !== username) { setConfirmRemove(username); return; }
    setConfirmRemove(null);
    const r = await fetch(`/api/access?username=${encodeURIComponent(username)}`, { method: "DELETE" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) setError(body.error ?? `HTTP ${r.status}`);
    if (who === username) setWho("");
    load();
  }

  function showLog(next: { kind?: AccessKind; who?: string }) {
    if (next.kind !== undefined) setKind(next.kind);
    if (next.who !== undefined) setWho(next.who);
    setTimeout(() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function exportCsv() {
    if (!data) return;
    const rows = [["Time", "Event", "Person", "Page or detail", "Location", "IP address", "Device"]];
    for (const e of events) {
      rows.push([e.at, eventStyle(e.event).label, e.username ? (data.members.find((m) => m.username === e.username)?.display ?? plain(e.username)) : "", e.event === "page" ? pageLabel(e.path).label : e.detail ?? "",
        e.place ?? "", e.ip ?? "", device(e.user_agent)]);
    }
    const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-log-${data.today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const people = useMemo(() => {
    const t = peopleQ.trim().toLowerCase();
    return (data?.members ?? []).filter((m) => !t || m.display.toLowerCase().includes(t) || ROLE[m.role].label.toLowerCase().includes(t)
      || (m.last_place ?? "").toLowerCase().includes(t));
  }, [data, peopleQ]);

  const groups = useMemo(() => {
    const out: { day: string; rows: AccessEventRow[] }[] = [];
    for (const e of events) {
      const day = e.at.slice(0, 10);
      if (out.length && out[out.length - 1].day === day) out[out.length - 1].rows.push(e);
      else out.push({ day, rows: [e] });
    }
    return out;
  }, [events]);

  if (error && !data) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-slate-100" />)}</div>
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const s = data.stats;
  const allowedCount = data.members.filter((m) => m.allowed).length;
  const whoName = who ? data.members.find((m) => m.username === who)?.display ?? plain(who) : "";
  const topMax = Math.max(1, ...data.topPages.map((p) => p.views));
  const names = new Map(data.members.map((m) => [m.username, m.display]));
  const nameOf = (u: string) => names.get(u) ?? plain(u);

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="People active" value={s.active7d.toLocaleString()} sub={`last 7 days · ${allowedCount} can sign in`} tone="cyan" icon={icons.users} />
        <StatTile label="Sign-ins" value={s.logins7d.toLocaleString()} sub={`last 7 days · ${s.loginsToday} today`} tone="violet" icon={icons.profile} />
        <StatTile label="Page views" value={s.pages7d.toLocaleString()} sub="last 7 days" tone="sky" icon={icons.grid} />
        <button type="button" onClick={() => showLog({ kind: "failed" })} className="text-left" title="Show failed attempts in the log">
          <StatTile label="Failed attempts" value={s.failed7d.toLocaleString()}
                    sub={s.failed7d ? `last 7 days · from ${s.failedIps7d} address${s.failedIps7d === 1 ? "" : "es"}` : "last 7 days · none"}
                    tone={s.failed7d ? "pink" : "emerald"} icon={icons.quality} />
        </button>
      </div>

      {/* Activity over time + most opened pages */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Activity, last 14 days" sub={`Page views and sign-ins per day · times in ${data.timeZone}`} className="xl:col-span-2">
          <DailyChart daily={data.daily} today={data.today} />
        </Card>
        <Card title="Most opened pages" sub="Last 30 days">
          {data.topPages.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No page views yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.topPages.map((p) => {
                const pg = pageLabel(p.path);
                return (
                  <li key={p.path}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      {pg.href ? <Link href={pg.href} className="min-w-0 truncate text-slate-700 hover:text-brand-600">{pg.label}</Link>
                        : <span className="min-w-0 truncate font-mono text-xs text-slate-700">{pg.label}</span>}
                      <span className="shrink-0 tabular-nums text-slate-500">
                        <b className="font-display font-semibold text-slate-900">{p.views.toLocaleString()}</b>
                        <span className="ml-1 text-[11px]">· {p.people} {p.people === 1 ? "person" : "people"}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-brand-500/80" style={{ width: `${Math.max(3, (p.views / topMax) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* People */}
      <Card
        title="People"
        sub={<>Everyone who can sign in, and anyone with activity in the last 180 days. Click a person to see only their activity.</>}
        right={
          <label className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
            <input value={peopleQ} onChange={(e) => setPeopleQ(e.target.value)} placeholder="Find a person…"
                   className="w-52 rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-500" />
          </label>
        }
        bodyClass="overflow-x-auto"
      >
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-5 py-2.5 font-semibold">Person</th>
              <th className="px-3 py-2.5 font-semibold">Last active</th>
              <th className="px-3 py-2.5 font-semibold">Last sign-in</th>
              <th className="px-3 py-2.5 text-right font-semibold">Sign-ins · 30 d</th>
              <th className="px-3 py-2.5 text-right font-semibold">Pages · 30 d</th>
              <th className="px-3 py-2.5 font-semibold">Location</th>
              <th className="px-5 py-2.5 font-semibold">Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">{peopleQ ? "No one matches." : "No activity recorded yet."}</td></tr>
            ) : people.map((m) => {
              const online = m.idle_s !== null && m.idle_s < 300;
              const selected = who === m.username;
              return (
                <tr key={m.username} onClick={() => showLog({ who: selected ? "" : m.username })}
                    className={`cursor-pointer transition ${selected ? "bg-brand-500/5" : "hover:bg-slate-50"} ${m.allowed ? "" : "opacity-75"}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.display} role={m.role} online={online} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-900">{m.display}</span>
                          <RoleChip role={m.role} />
                          {!m.allowed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200" title="Can no longer sign in">No access</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {online ? <span className="text-emerald-600">Online now</span> : m.allowed ? "Can sign in" : "Access ended or removed"}
                          {!m.allowed && data.canErase && (
                            <button type="button" onClick={(ev) => { ev.stopPropagation(); remove(m.username); }}
                                    className="ml-2 font-medium text-rose-700 hover:underline" title="Deletes this person's activity history">
                              {confirmRemove === m.username ? "Click again to remove history" : "Remove history"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700" title={m.last_seen ?? undefined}>{ago(m.idle_s)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-700" title={m.last_login ?? undefined}>{m.login_idle_s === null ? <span className="text-slate-400">—</span> : ago(m.login_idle_s)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">{m.logins_30d}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">{m.pages_30d}</td>
                  <td className="px-3 py-3 text-slate-700" title={m.last_ip ?? undefined}>
                    {m.last_place ? <>{flag(m.last_country)} {m.last_place}</> : <span className="text-slate-400">—</span>}
                    {m.countries.length > 1 && <span className="ml-1 text-xs text-slate-400">+{m.countries.length - 1} more</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{device(m.last_agent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Activity log */}
      <div ref={logRef} className="scroll-mt-24">
        <Card
          title="Activity log"
          sub={<>Newest first · kept for 180 days · times in {data.timeZone}</>}
          right={
            <div className="flex flex-wrap gap-2">
              <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500">
                <option value="">Everyone</option>
                {data.members.map((m) => <option key={m.username} value={m.username}>{m.display} ({ROLE[m.role].label.toLowerCase()})</option>)}
              </select>
              <label className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">{icons.search}</span>
                <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Page, name, IP or city…" aria-label="Search the log"
                       className="w-52 rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-500" />
              </label>
              <button type="button" onClick={exportCsv} disabled={!events.length} title="Download the entries shown as a spreadsheet (CSV)"
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950 disabled:opacity-50">
                {icons.external}<span>Export CSV</span>
              </button>
            </div>
          }
          bodyClass=""
        >
          {/* Type tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2.5">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${kind === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${kind === k ? "bg-white/20" : k === "failed" && data.counts.failed ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}>
                  {data.counts[k].toLocaleString()}
                </span>
              </button>
            ))}
          </div>

          {(who || q || kind !== "all") && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2 text-xs text-slate-600">
              Showing {kind === "all" ? "everything" : TABS.find(([k]) => k === kind)?.[1].toLowerCase()}
              {who && <> for <b className="font-semibold text-slate-900">{whoName}</b></>}
              {q && <> matching “{q}”</>}
              <button type="button" onClick={() => { setKind("all"); setWho(""); setQInput(""); setQ(""); }} className="ml-1 font-medium text-brand-600 hover:underline">
                Clear filters
              </button>
            </div>
          )}

          {/* Entries, grouped by day */}
          <div className={`max-h-[680px] overflow-y-auto overscroll-contain transition-opacity ${loading ? "opacity-50" : ""}`}>
            {events.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-slate-400">Nothing recorded{who || q || kind !== "all" ? " for these filters" : " yet"}.</p>
            ) : groups.map((g, gi) => (
              <div key={`${g.day}-${gi}`}>
                <div className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50/95 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
                  {dayHeading(g.day, data.today)} <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">· {g.rows.length} {g.rows.length === 1 ? "entry" : "entries"}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.rows.map((e) => {
                    const st = eventStyle(e.event);
                    return (
                      <li key={e.id} className="flex flex-col gap-1 px-5 py-2.5 hover:bg-slate-50/70 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-slate-500" title={e.at}>{e.at.slice(11, 16)}</span>
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:h-3.5 [&_svg]:w-3.5 ${st.chip}`} title={st.label}>{st.icon}</span>
                          <span className="min-w-0 truncate text-[13.5px] text-slate-700">{describe(e, nameOf)}</span>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[5.75rem] text-xs text-slate-500 sm:pl-0">
                          {e.place && <span className="whitespace-nowrap">{flag(e.country)} {e.place}</span>}
                          <span className="whitespace-nowrap">{device(e.user_agent)}</span>
                          {e.ip && <span className="whitespace-nowrap font-mono text-[11px] text-slate-400">{e.ip}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>{events.length.toLocaleString()} of {data.counts[kind].toLocaleString()} entries shown · locations come from the IP address and are approximate</span>
            {hasMore && (
              <button type="button" onClick={loadMore} disabled={loadingMore}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-500/50 disabled:opacity-60">
                {loadingMore ? "Loading…" : "Load older entries"}
              </button>
            )}
          </div>
        </Card>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
