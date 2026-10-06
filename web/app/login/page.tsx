"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark } from "@/components/Logo";

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

  const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="u" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Username</label>
        <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={input} autoFocus required />
      </div>
      <div>
        <label htmlFor="p" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Password</label>
        <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} required />
      </div>
      {params.get("ended") && !error && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          You were signed out. If your access was time-limited, it has ended — ask the person who gave you access.
        </p>
      )}
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in →"}
      </button>
    </form>
  );
}

const FEATURES = [
  ["Every obesity trial", "Interventional trials from ClinicalTrials.gov, refreshed daily."],
  ["Drug-level intelligence", "Each trial linked to its drugs, sponsors, phases and regions."],
  ["Change tracking", "See what moved in the registry — new trials, status and phase changes."],
];

/** Decorative orbit: rings and moving "molecules" behind the headline. */
function Orbit() {
  return (
    <div className="pointer-events-none absolute -right-24 -top-10 hidden h-[420px] w-[420px] opacity-70 lg:block" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-brand-500/15" />
      <div className="absolute inset-10 rounded-full border border-accent-500/20" />
      <div className="absolute inset-24 rounded-full border border-brand-500/20" />
      <div className="absolute inset-0 animate-orbit">
        <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-brand-500 shadow-[0_0_16px_rgb(34_211_238)]" />
      </div>
      <div className="absolute inset-10 animate-orbit [animation-direction:reverse] [animation-duration:18s]">
        <span className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-accent-500 shadow-[0_0_14px_rgb(167_139_250)]" />
      </div>
      <div className="absolute inset-24 animate-orbit [animation-duration:12s]">
        <span className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-pink-400 shadow-[0_0_12px_rgb(244_114_182)]" />
      </div>
      <div className="absolute inset-[150px] rounded-full bg-gradient-to-br from-brand-500/25 to-accent-500/25 blur-2xl" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative mx-auto grid min-h-[70vh] max-w-6xl items-center gap-10 py-6 lg:grid-cols-[1.15fr_1fr]">
      <div className="relative">
        <Orbit />
        <div className="relative">
          <div className="eyebrow mb-4 flex items-center gap-2">
            <span className="h-px w-6 bg-gradient-to-r from-transparent to-brand-500" /> Private intelligence platform
          </div>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-slate-950 md:text-5xl">
            The obesity drug pipeline,
            <br />
            <span className="text-gradient">decoded.</span>
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-slate-500">
            Track every obesity drug in development — who is running which trial, in which phase and where — with clean,
            structured data you can trust.
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white font-display text-xs font-semibold text-brand-500">
                  0{i + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{t}</span>
                  <span className="text-sm text-slate-500">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative">
        <div className="absolute -inset-px rounded-[22px] bg-gradient-to-br from-brand-500/50 via-accent-500/20 to-transparent opacity-70 blur-[1px]" aria-hidden="true" />
        <div className="glass relative rounded-[22px] p-7 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <LogoMark size={40} />
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Sign in</h2>
              <p className="text-sm text-slate-500">This database is private. Sign in to continue.</p>
            </div>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-6 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
            Need access? Ask your account owner for a login.
          </p>
        </div>
      </div>
    </div>
  );
}
