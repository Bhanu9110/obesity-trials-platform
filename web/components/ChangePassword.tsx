"use client";

import { useState } from "react";

const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

/** Profile page: change your own password (logins made on the site). */
export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== again) { setMsg({ ok: false, text: "The two new passwords don't match." }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/profile/password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setCurrent(""); setNext(""); setAgain("");
      setMsg({ ok: true, text: "Password changed. Use the new one next time you sign in." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={64} autoComplete="new-password" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          New password again
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={64} autoComplete="new-password" className={input} />
        </label>
      </div>
      <p className="text-xs text-slate-500">8–64 characters, no spaces or commas. Once you change it, admins can no longer see your password.</p>
      {msg && (
        <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>
      )}
      <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
