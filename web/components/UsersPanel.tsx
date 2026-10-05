"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SiteUser } from "@/lib/site-users";
import type { OwnerRow } from "@/app/api/users/route";
import { DEFAULT_GUEST_PAGES, GUEST_PAGES, cleanPages, type GuestPage } from "@/lib/guest-pages";

// Admin page: every login in one place. Owners come from Vercel (AUTH_USERS) and
// are shown read-only; members and guests are created and managed here.

type Role = "member" | "guest";

const DURATIONS: [number, string][] = [
  [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"],
  [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [480, "8 hours"],
  [1440, "1 day"], [4320, "3 days"], [10080, "7 days"], [20160, "14 days"], [43200, "30 days"],
];
const ADD_TIME: [number, string][] = [[30, "+30 min"], [60, "+1 hour"], [1440, "+1 day"], [10080, "+7 days"]];
const PAGE_LABEL = Object.fromEntries(GUEST_PAGES.map((p) => [p.key, p.label])) as Record<GuestPage, string>;

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min left`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} hours left`;
  return `${Math.round(h / 24)} days left`;
}

const TYPE_TAG = {
  owner: "bg-violet-50 text-violet-700 ring-violet-200",
  member: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  guest: "bg-sky-50 text-sky-700 ring-sky-200",
} as const;

const btn = "rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 transition";
const btnPlain = `${btn} bg-white text-slate-700 ring-slate-300 hover:bg-slate-50`;
const btnBrand = `${btn} bg-brand-600 text-white ring-brand-600 hover:bg-brand-700 disabled:opacity-50`;
const btnDanger = `${btn} bg-white text-rose-700 ring-rose-200 hover:bg-rose-50`;
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

/** Tick boxes for the pages a guest may open. Admin is shown, locked off. */
function PagePicker({ value, onChange }: { value: GuestPage[]; onChange: (v: GuestPage[]) => void }) {
  const toggle = (k: GuestPage) => onChange(cleanPages(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {GUEST_PAGES.map((p) => {
        const sub = p.key === "quality_export";
        const disabled = sub && !value.includes("quality");
        return (
          <label key={p.key} title={p.hint}
                 className={`flex items-center gap-1.5 text-sm ${disabled ? "text-slate-300" : "text-slate-700"} ${sub ? "-ml-2" : ""}`}>
            <input type="checkbox" checked={value.includes(p.key)} disabled={disabled} onChange={() => toggle(p.key)}
                   className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
            {sub ? "+ CSV download" : p.label}
          </label>
        );
      })}
      <span className="flex items-center gap-1.5 text-sm text-slate-400" title="Guests can never open the Admin page">
        <input type="checkbox" checked={false} disabled className="h-4 w-4" /> Admin <span className="text-xs">(never)</span>
      </span>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
                className={`rounded-md px-3 py-1.5 text-sm ${value === v ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function loginText(username: string, password: string, u: Pick<SiteUser, "role" | "pages" | "expires_at">) {
  return [
    "Obesity Trials Intelligence — login",
    `Sign in at: ${window.location.origin}/login`,
    `Username: ${username}`,
    `Password: ${password}`,
    `Access: ${u.role === "member" ? "all pages" : u.pages.map((k) => PAGE_LABEL[k]).join(", ")}`,
    `Valid until: ${u.expires_at ? fmt(u.expires_at) : "no end date"}`,
  ].join("\n");
}

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method, cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export default function UsersPanel() {
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [users, setUsers] = useState<SiteUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "ended" | "all">("active");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [details, setDetails] = useState<{ title: string; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api("GET", "/api/users");
      setOwners(d.owners);
      setUsers(d.users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2500); };

  async function copyLogin(u: SiteUser) {
    setError(null);
    try {
      const r = await api("GET", `/api/users/${u.id}/password`);
      if (!r.password) {
        setError(`The password for ${u.username} wasn't kept (made before this update). Open Manage → New password.`);
        return;
      }
      await navigator.clipboard.writeText(loginText(u.username, r.password, u));
      say(`Login details for ${u.username} copied`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const counts = useMemo(() => ({
    active: users?.filter((u) => u.status === "active").length ?? 0,
    ended: users?.filter((u) => u.status !== "active").length ?? 0,
  }), [users]);

  // The login you are managing stays in view even when ending or reopening it moves it to the other tab.
  const shown = (users ?? []).filter((u) =>
    (u.id === open || view === "all" || (view === "active" ? u.status === "active" : u.status !== "active")) &&
    (!q || `${u.username} ${u.label}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="max-w-3xl">
          <h2 className="text-sm font-semibold text-slate-900">Users &amp; access</h2>
          <p className="text-xs text-slate-500">
            <b>Members</b> can open every page except Admin and edit drug profiles. <b>Guests</b> can only open the pages you choose, view-only, until their time runs out.
            Only owners (set in Vercel) can open this Admin page. Deleting or ending a login signs that person out on their next click.
          </p>
        </div>
        <button type="button" onClick={() => { setAdding((a) => !a); setDetails(null); }} className={btnBrand + " px-3 py-2 text-sm"}>
          {adding ? "Close" : "+ Add user"}
        </button>
      </div>

      {adding && (
        <AddUser
          onCancel={() => setAdding(false)}
          onCreated={(u, password) => {
            setAdding(false);
            setDetails({ title: `Login created for ${u.label}`, text: loginText(u.username, password, u) });
            setView("active");
            load();
          }}
        />
      )}

      {details && <DetailsCard {...details} onDone={() => setDetails(null)} />}
      {error && <p className="mx-5 mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {flash && <p className="mx-5 mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <Segmented value={view} onChange={setView}
                   options={[["active", `Active (${counts.active})`], ["ended", `Ended (${counts.ended})`], ["all", "All"]]} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a user…"
               className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500" />
      </div>

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Can open</th>
              <th className="px-3 py-2 font-semibold">Access</th>
              <th className="px-3 py-2 font-semibold">Last sign-in</th>
              <th className="px-5 py-2 text-right font-semibold"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {view !== "ended" && !q && owners.map((o) => (
              <tr key={`owner-${o.username}`} className="bg-violet-50/30">
                <td className="px-5 py-2.5">
                  <div className="font-mono text-[13px] font-medium text-slate-800">{o.username}</div>
                  <div className="text-xs text-slate-500">Owner account</div>
                </td>
                <td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${TYPE_TAG.owner}`}>Owner</span></td>
                <td className="px-3 py-2.5 text-slate-600">{o.admin ? "Everything, including Admin" : "Every page except Admin"}</td>
                <td className="px-3 py-2.5 text-slate-600">No end date</td>
                <td className="px-3 py-2.5 text-slate-400">—</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right text-xs text-slate-400">Set in Vercel</td>
              </tr>
            ))}
            {!users ? (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">{error ? "—" : "Loading…"}</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">
                {q ? "No user matches." : view === "ended" ? "No ended logins." : "No users yet — click “+ Add user”."}
              </td></tr>
            ) : shown.map((u) => (
              <UserRows key={u.id} u={u} open={open === u.id}
                        onToggle={() => setOpen(open === u.id ? null : u.id)}
                        onCopy={() => copyLogin(u)}
                        onChanged={(msg) => { if (msg) say(msg); load(); }}
                        onDeleted={() => { setOpen(null); say(`${u.username} deleted`); load(); }}
                        onDetails={(title, text) => setDetails({ title, text })}
                        onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailsCard({ title, text, onDone }: { title: string; text: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-emerald-800">{title}</span>
        <div className="flex gap-2">
          <button type="button" className={btnPlain}
                  onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* ignore */ } }}>
            {copied ? "Copied ✓" : "Copy login details"}
          </button>
          <button type="button" onClick={onDone} className="rounded-md px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100">Done</button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-[13px] text-slate-800 ring-1 ring-emerald-200">{text}</pre>
      <p className="mt-2 text-xs text-emerald-800">You can copy these again any time with “Copy login” in the list.</p>
    </div>
  );
}

function AddUser({ onCancel, onCreated }: { onCancel: () => void; onCreated: (u: SiteUser, password: string) => void }) {
  const [role, setRole] = useState<Role>("guest");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [minutes, setMinutes] = useState<number | null>(10080);
  const [pages, setPages] = useState<GuestPage[]>(DEFAULT_GUEST_PAGES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickRole(r: Role) {
    setRole(r);
    if (r === "guest" && minutes === null) setMinutes(10080);
    if (r === "member") setMinutes(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api("POST", "/api/users", {
        role, label, username: username || undefined, password: password || undefined, minutes, pages: role === "guest" ? pages : undefined,
      });
      onCreated(d.user, d.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={role} onChange={pickRole} options={[["guest", "Guest"], ["member", "Member"]]} />
        <span className="text-xs text-slate-500">
          {role === "guest" ? "Only the pages you tick, view-only, for a limited time." : "Every page except Admin; can edit drug profiles."}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Name / who it&apos;s for
          <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120}
                 placeholder="e.g. Rahul – CI team, Acme Pharma" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Username <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30}
                 placeholder="made up for you" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Password <span className="font-normal text-slate-400">(optional)</span></span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64}
                 placeholder="made up for you" className={input} autoComplete="new-password" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Access for
          <select value={minutes ?? ""} onChange={(e) => setMinutes(e.target.value === "" ? null : Number(e.target.value))} className={input}>
            {role === "member" && <option value="">No end date</option>}
            {DURATIONS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
        </label>
      </div>
      {role === "guest" && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Pages they can open</div>
          <PagePicker value={pages} onChange={setPages} />
        </div>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || (role === "guest" && !pages.length)} className={btnBrand + " px-4 py-2 text-sm"}>
          {busy ? "Creating…" : `Create ${role}`}
        </button>
        <button type="button" onClick={onCancel} className={btnPlain + " px-4 py-2 text-sm"}>Cancel</button>
      </div>
    </form>
  );
}

function UserRows({
  u, open, onToggle, onCopy, onChanged, onDeleted, onDetails, onError,
}: {
  u: SiteUser; open: boolean; onToggle: () => void; onCopy: () => void;
  onChanged: (msg?: string) => void; onDeleted: () => void;
  onDetails: (title: string, text: string) => void; onError: (m: string | null) => void;
}) {
  const ended = u.status !== "active";
  const status = u.status === "revoked" ? "Revoked" : u.status === "expired" ? "Expired"
    : u.expires_at ? timeLeft(u.expires_at) : "No end date";
  const statusStyle = u.status === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : u.status === "revoked" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <>
      <tr className={`${ended ? "text-slate-500" : ""} ${open ? "bg-slate-50" : ""}`}>
        <td className="px-5 py-2.5">
          <div className="font-mono text-[13px] font-medium text-slate-800">{u.username}</div>
          <div className="max-w-[260px] truncate text-xs text-slate-500" title={u.label}>{u.label}</div>
        </td>
        <td className="px-3 py-2.5">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${TYPE_TAG[u.role]}`}>{u.role === "member" ? "Member" : "Guest"}</span>
        </td>
        <td className="px-3 py-2.5">
          {u.role === "member" ? <span className="text-slate-600">Every page except Admin</span> : (
            <div className="flex flex-wrap gap-1">
              {u.pages.map((k) => (
                <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{k === "quality_export" ? "CSV" : PAGE_LABEL[k]}</span>
              ))}
            </div>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${statusStyle}`}>{status}</span>
          {u.expires_at && u.status === "active" && <div className="mt-0.5 text-[11px] text-slate-400">until {fmt(u.expires_at)}</div>}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
          {u.last_login_at ? <>{fmt(u.last_login_at)} <span className="text-xs text-slate-400">({u.login_count}×)</span></> : <span className="text-slate-400">never</span>}
        </td>
        <td className="whitespace-nowrap px-5 py-2.5 text-right">
          {!ended && <button type="button" onClick={onCopy} className={btnPlain}>Copy login</button>}
          <button type="button" onClick={onToggle} className={`${open ? btnBrand : btnPlain} ml-2`}>
            {open ? "Close" : "Manage"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-5 pb-5 pt-1">
            <Manage u={u} onChanged={onChanged} onDeleted={onDeleted} onDetails={onDetails} onError={onError} />
          </td>
        </tr>
      )}
    </>
  );
}

/** "2026-10-05T18:30" for a datetime-local input, in the viewer's time zone. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function AccessTime({
  u, busy, patch,
}: { u: SiteUser; busy: boolean; patch: (body: Record<string, unknown>, msg?: string) => Promise<void> }) {
  const active = u.status === "active";
  const timed = active && Boolean(u.expires_at);
  // Active with an end date: time is added on top. Otherwise it is counted from now.
  const base = timed ? new Date(u.expires_at!).getTime() : Date.now();
  const [until, setUntil] = useState(() => localInput(base + 86_400_000));
  // Suggest "a day after the current end" (or a day from now once access has ended).
  useEffect(() => { setUntil(localInput(base + 86_400_000)); }, [u.status, u.expires_at]);
  const endText = (ms: number) => fmt(new Date(ms).toISOString());

  return (
    <Card title="Access time">
      <div className={`mb-3 rounded-md px-3 py-2 text-sm ${active ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
        {u.status === "revoked" ? <>Access ended {fmt(u.revoked_at)}.</>
          : u.status === "expired" ? <>Access ran out {fmt(u.expires_at)}.</>
          : u.expires_at ? <>Active until <b>{fmt(u.expires_at)}</b> · {timeLeft(u.expires_at)}</>
          : <>Active · no end date</>}
      </div>

      <div className="mb-1.5 text-xs font-medium text-slate-600">
        {timed ? "Add time to what's left" : active ? "Limit access to (from now)" : "Give access again for (from now)"}
      </div>
      <div className="flex flex-wrap gap-2">
        {ADD_TIME.map(([m, l]) => {
          const newEnd = base + m * 60_000;
          return (
            <button key={m} type="button" disabled={busy} title={`New end: ${endText(newEnd)}`}
                    onClick={() => patch({ action: "extend", minutes: m }, `Access until ${endText(newEnd)}`)} className={btnPlain}>
              {timed ? l : l.replace("+", "")}
            </button>
          );
        })}
        {u.role === "member" && (u.expires_at || !active) && (
          <button type="button" disabled={busy} onClick={() => patch({ action: "no_end" }, "No end date")} className={btnPlain}>No end date</button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Or until</span>
        <input type="datetime-local" value={until} min={localInput(Date.now() + 120_000)} onChange={(e) => setUntil(e.target.value)}
               className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500" />
        <button type="button" disabled={busy || !until}
                onClick={() => patch({ action: "set_end", until: new Date(until).toISOString() }, `Access until ${endText(new Date(until).getTime())}`)}
                className={btnPlain}>Set</button>
      </div>

      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button type="button" disabled={busy} onClick={() => patch({ action: "revoke" }, "Access ended")} className={btnDanger}>
            End access now
          </button>
          <span className="text-xs text-slate-500">Signs them out; any time left is cleared.</span>
        </div>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  );
}

function Manage({
  u, onChanged, onDeleted, onDetails, onError,
}: {
  u: SiteUser; onChanged: (msg?: string) => void; onDeleted: () => void;
  onDetails: (title: string, text: string) => void; onError: (m: string | null) => void;
}) {
  const [password, setPassword] = useState<string | null | undefined>(undefined); // undefined = hidden
  const [pages, setPages] = useState<GuestPage[]>(u.pages);
  const [label, setLabel] = useState(u.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, msg?: string) {
    setBusy(true);
    onError(null);
    try {
      const r = await api("PATCH", "/api/users", { id: u.id, ...body });
      if (body.action === "password" && r.password) {
        setPassword(r.password);
        onDetails(`New password for ${u.username}`, loginText(u.username, r.password, r.user));
      }
      onChanged(msg);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (password !== undefined) { setPassword(undefined); return; }
    try {
      const r = await api("GET", `/api/users/${u.id}/password`);
      setPassword(r.password);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api("DELETE", `/api/users?id=${u.id}`);
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const pagesChanged = pages.join() !== u.pages.join();

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Login">
        <dl className="grid grid-cols-[90px_1fr] items-center gap-y-2 text-sm">
          <dt className="text-slate-500">Username</dt>
          <dd className="font-mono">{u.username}</dd>
          <dt className="text-slate-500">Password</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="font-mono">
              {password === undefined ? "••••••••••••" : password ?? <span className="font-sans text-xs text-amber-700">not kept for this login — make a new one</span>}
            </span>
            {(u.has_password_copy || password !== undefined) && (
              <button type="button" onClick={reveal} className={btnPlain}>{password === undefined ? "Show" : "Hide"}</button>
            )}
            <button type="button" disabled={busy} onClick={() => patch({ action: "password" }, "New password made")} className={btnPlain}>
              New password
            </button>
          </dd>
          <dt className="text-slate-500">Name</dt>
          <dd className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={`${input} py-1.5`} />
            {label.trim() !== u.label && (
              <button type="button" disabled={busy} onClick={() => patch({ action: "label", label }, "Name saved")} className={btnBrand}>Save</button>
            )}
          </dd>
        </dl>
      </Card>

      <AccessTime u={u} busy={busy} patch={patch} />

      <Card title="Type and pages">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented value={u.role} onChange={(r) => r !== u.role && patch({ action: "role", role: r }, `Now a ${r}`)}
                     options={[["guest", "Guest"], ["member", "Member"]]} />
          <span className="text-xs text-slate-500">Changing the type signs them out once.</span>
        </div>
        {u.role === "guest" ? (
          <>
            <PagePicker value={pages} onChange={setPages} />
            {pagesChanged && (
              <button type="button" disabled={busy || !pages.length} onClick={() => patch({ action: "pages", pages }, "Pages saved")}
                      className={`${btnBrand} mt-3`}>Save pages</button>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">Members can open every page except Admin.</p>
        )}
      </Card>

      <Card title="Delete">
        <p className="mb-3 text-sm text-slate-600">
          Removes this login for good — they can&apos;t sign in again. Their past activity stays in “Who is using the website”.
        </p>
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className={btnDanger}>Delete {u.username}</button>
        ) : (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={remove} className={`${btn} bg-rose-600 text-white ring-rose-600 hover:bg-rose-700`}>
              Yes, delete permanently
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={btnPlain}>Cancel</button>
          </div>
        )}
      </Card>
    </div>
  );
}
