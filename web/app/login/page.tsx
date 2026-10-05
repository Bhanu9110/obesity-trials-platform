"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only allow redirects back into this site.
  const nextRaw = params.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Full page load (not client-side navigation): the router may still hold the
      // pre-login "redirect to /login" for this page, which would leave us here.
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="u" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Username</label>
        <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={input} autoFocus required />
      </div>
      <div>
        <label htmlFor="p" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
        <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} required />
      </div>
      {params.get("ended") && !error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You were signed out. If your access was time-limited, it has ended — ask the person who gave you access.
        </p>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mb-5 text-sm text-slate-500">This database is private. Sign in to continue.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
