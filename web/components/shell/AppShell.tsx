"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { icons, type IconName } from "./icons";
import CommandPalette from "./CommandPalette";

/** Sun / moon switch. Light is the default; the choice is remembered on this device. */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  function flip() {
    const next = !dark;
    const root = document.documentElement;
    root.classList.add("theme-switching");
    if (next) root.dataset.theme = "dark"; else delete root.dataset.theme;
    try { localStorage.setItem("otd-theme", next ? "dark" : "light"); } catch { /* storage off */ }
    setDark(next);
    setTimeout(() => root.classList.remove("theme-switching"), 350);
  }
  return (
    <button type="button" onClick={flip} title={dark ? "Switch to light" : "Switch to dark"} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition hover:text-slate-900 hover:ring-slate-300">
      {dark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
      )}
    </button>
  );
}

export interface ShellNavItem { href: string; label: string; icon: IconName; section: "Intelligence" | "Workspace" }
export interface ShellUser { name: string; username: string; badge?: string | null; role: "owner" | "member" | "guest" }

const ROLE_LABEL = { owner: "Owner", member: "Member", guest: "Guest" } as const;
/** "Priya – our analyst" -> "PR"; "obeybhanu" -> "OB". */
const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/trials") return pathname === "/trials" || pathname.startsWith("/trials/");
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The signed-in frame: sidebar (collapsible; a drawer on phones), top bar with
 * global search (Ctrl/⌘ K or "/"), and the user menu.
 */
export default function AppShell({
  nav, user, homeHref, canTrials, children,
}: { nav: ShellNavItem[]; user: ShellUser | null; homeHref: string; canTrials: boolean; children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("otd-sidebar") === "collapsed"); } catch { /* storage off */ }
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem("otd-sidebar", c ? "open" : "collapsed"); } catch { /* storage off */ }
      return !c;
    });
  }

  const sections = (["Intelligence", "Workspace"] as const).map((s) => ({ s, items: nav.filter((n) => n.section === s) })).filter((x) => x.items.length);

  const sidebar = (mobile: boolean) => {
    const mini = collapsed && !mobile;
    return (
      <div className="flex h-full flex-col">
        <div className={`flex h-16 items-center ${mini ? "justify-center" : "justify-between px-4"}`}>
          <Link href={homeHref} className="group flex items-center gap-2.5">
            <span className="transition-transform duration-300 group-hover:rotate-[8deg]"><LogoMark size={34} /></span>
            {!mini && (
              <span className="leading-tight">
                <span className="block font-display text-[14px] font-semibold tracking-tight text-slate-950">Obesity Trials</span>
                <span className="block font-display text-[12px] font-semibold tracking-[0.2em] text-gradient">INTELLIGENCE</span>
              </span>
            )}
          </Link>
          {mobile && (
            <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-500 hover:text-slate-900" aria-label="Close menu">
              {icons.close}
            </button>
          )}
        </div>

        <nav className="mt-2 flex-1 space-y-6 overflow-y-auto px-3">
          {sections.map(({ s, items }) => (
            <div key={s}>
              {!mini && <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{s}</div>}
              <div className="space-y-1">
                {items.map((it) => {
                  const active = isActive(pathname, it.href);
                  return (
                    <Link key={it.href} href={it.href} title={mini ? it.label : undefined}
                          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition ${
                            mini ? "justify-center" : ""} ${
                            active
                              ? "bg-gradient-to-r from-brand-500/15 via-brand-500/5 to-transparent text-slate-950 ring-1 ring-brand-500/25"
                              : "text-slate-500 hover:bg-slate-100/50 hover:text-slate-900"}`}>
                      {active && <span className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500 shadow-[0_0_12px_rgb(34_211_238)]" />}
                      <span className={active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-700"}>{icons[it.icon]}</span>
                      {!mini && <span>{it.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-3 p-3">
          {!mini && (
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-emerald-400/20 blur-xl" />
              <div className="flex items-center gap-2 text-xs font-medium text-slate-800">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153)]" />
                Live data feed
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">ClinicalTrials.gov registry, synced every day.</p>
            </div>
          )}
          {!mobile && (
            <button type="button" onClick={toggle}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400 transition hover:bg-slate-100/50 hover:text-slate-800 ${mini ? "justify-center" : ""}`}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <span className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>{icons.chevronLeft}</span>
              {!mini && "Collapse"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 border-r border-slate-200/70 bg-chrome backdrop-blur-xl transition-[width] duration-300 lg:block ${
        collapsed ? "w-[76px]" : "w-[248px]"}`}>
        {sidebar(false)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[270px] animate-fade-up border-r border-slate-200 bg-panel">
            {sidebar(true)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-chrome backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 md:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-500 hover:text-slate-900 lg:hidden" aria-label="Open menu">
              {icons.menu}
            </button>
            <button type="button" onClick={() => setPaletteOpen(true)}
                    className="group flex h-10 w-full max-w-xl items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-left text-sm text-slate-400 transition hover:border-brand-500/40 hover:bg-slate-50 hover:text-slate-600">
              <span className="text-slate-400 group-hover:text-brand-600">{icons.search}</span>
              <span className="flex-1 truncate">Search trials, drugs, sponsors…</span>
              <kbd className="hidden rounded-md border border-slate-200 bg-slate-100/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline">
                {isMac ? "⌘" : "Ctrl"} K
              </kbd>
            </button>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              {user && (
                <div className="flex items-center gap-2.5">
                  <div className="hidden max-w-[220px] text-right leading-tight md:block" title={`Signed in as ${user.username}`}>
                    <div className="truncate text-[13px] font-medium text-slate-900">{user.name}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {user.name !== user.username ? `${user.username} · ` : ""}{ROLE_LABEL[user.role]}{user.badge ? ` · until ${user.badge}` : ""}
                    </div>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-500/40 to-accent-500/40 font-display text-xs font-semibold uppercase text-slate-950 ring-1 ring-slate-300"
                        title={`Signed in as ${user.username}`}>
                    {initials(user.name)}
                  </span>
                  <form action="/api/auth/logout" method="post">
                    <button type="submit" title="Sign out" aria-label="Sign out"
                            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 ring-1 ring-slate-200 transition hover:text-rose-600 hover:ring-rose-200">
                      {icons.logout}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 animate-fade-up px-4 py-7 md:px-6">{children}</main>

        <footer className="border-t border-slate-200/60">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-slate-400 md:px-6">
            <span className="flex items-center gap-2"><LogoMark size={16} /> Obesity Trials Intelligence</span>
            <span>Trial data from ClinicalTrials.gov (v2 API), synced daily · drug information curated by our team</span>
          </div>
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} canTrials={canTrials}
                      nav={nav.map((n) => ({ href: n.href, label: n.label, icon: n.icon }))} />
    </div>
  );
}
