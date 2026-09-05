// The one shell for all of All-In-One, styled after the "Finexy" reference:
// warm canvas, TOP nav with pill tabs (active = ink pill), a floating icon
// rail on the left (lg+) with the same sections + sign-out, and in-content
// pill tabs for the active mini-app's sub-pages. No drawer/sidebar anymore.
//
// Add a new mini-app: one entry in APPS (name/icon/items) — the top nav, rail,
// sub-tabs and titles all derive from it.
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes, Home, LogOut, Server, LineChart, CandlestickChart,
  Gauge, Newspaper, SlidersHorizontal, Crosshair, NotebookPen, ChevronDown, Sun, Moon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "./ui";

const APPS = [
  {
    base: "/fin",
    name: "Financial Desk",
    icon: LineChart,
    items: [
      { to: "/fin", label: "Desk", icon: Gauge, end: true },
      { to: "/fin/news", label: "News", icon: Newspaper },
      { to: "/fin/settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
  {
    base: "/evs",
    name: "Earnings Vol",
    icon: CandlestickChart,
    items: [
      { to: "/evs", label: "Scanner", icon: Crosshair, end: true },
      { to: "/evs/trades", label: "Trades", icon: NotebookPen },
      { to: "/evs/settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
];

// Top-level sections: Home + each app + Infrastructure.
const SECTIONS = [
  { to: "/", label: "Home", icon: Home, end: true },
  ...APPS.map((a) => ({ to: a.base, label: a.name, icon: a.icon, end: false })),
  { to: "/infra", label: "Infrastructure", icon: Server, end: true },
];

const topPill = ({ isActive }: { isActive: boolean }) =>
  cn(
    "whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
    // dark mode flips the active pill to lime (ink-on-ink would vanish)
    isActive ? "bg-ink text-white dark:bg-accent dark:text-ink" : "text-slate-600 hover:bg-slate-100",
  );

// Light/dark toggle, shared by the rail pill and the profile dropdown.
function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const setTheme = (d: boolean) => {
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("aio:theme", d ? "dark" : "light"); } catch { /* ignore */ }
    setDark(d);
  };
  return { dark, setTheme };
}

function ThemeButtons({ dark, setTheme, size = "h-11 w-11" }: {
  dark: boolean; setTheme: (d: boolean) => void; size?: string;
}) {
  const btn = (active: boolean) =>
    cn(
      "flex items-center justify-center rounded-full transition-colors", size,
      active ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-700",
    );
  return (
    <>
      <button title="Light mode" aria-pressed={!dark} onClick={() => setTheme(false)} className={btn(!dark)}>
        <Sun className="h-5 w-5" />
      </button>
      <button title="Dark mode" aria-pressed={dark} onClick={() => setTheme(true)} className={btn(dark)}>
        <Moon className="h-5 w-5" />
      </button>
    </>
  );
}

const subPill = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
    isActive ? "bg-surface text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
  );

// Reference-style profile tab: avatar + stacked name/email + chevron, opening
// a small dropdown. Single-user app, so the display name is simply Jared.
function ProfileMenu({ email, dark, setTheme }: { email: string; dark: boolean; setTheme: (d: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full bg-surface py-1.5 pl-1.5 pr-3 shadow-sm transition-colors hover:bg-slate-100/70"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold uppercase text-accent">
          {email.slice(0, 1) || "?"}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-bold leading-tight text-slate-900">Jared</span>
          <span className="block max-w-[16ch] truncate text-[11px] leading-tight text-slate-500">{email}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-slate-200/60">
          <div className="border-b border-slate-100 px-3 pb-2.5 pt-2 sm:hidden">
            <p className="text-sm font-bold text-slate-900">Jared</p>
            <p className="truncate text-xs text-slate-500">{email}</p>
          </div>
          {/* the rail carries the toggle on lg+; this covers phones/tablets */}
          <div className="flex items-center justify-between px-3 py-2 lg:hidden">
            <span className="text-sm font-semibold text-slate-700">Theme</span>
            <div className="flex gap-1">
              <ThemeButtons dark={dark} setTheme={setTheme} size="h-8 w-8" />
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4 text-slate-400" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout({ email }: { email: string }) {
  const { pathname } = useLocation();
  const { dark, setTheme } = useTheme();
  const app = APPS.find((a) => pathname.startsWith(a.base));
  const title = app ? app.name : pathname === "/infra" ? "Infrastructure" : null;

  return (
    <div className="min-h-screen">
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-30 bg-slate-50/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3.5 sm:px-8">
          <NavLink to="/" className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent shadow-sm">
              <Boxes className="h-5 w-5 text-ink" />
            </span>
            <span className="hidden text-[17px] font-extrabold tracking-tight text-slate-900 sm:block">
              All-In-One
            </span>
          </NavLink>

          {/* section pills — centered on md+, scrollable row below the bar on mobile */}
          <nav className="mx-auto hidden items-center gap-1 rounded-full bg-surface p-1.5 shadow-sm md:flex">
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.end} className={topPill}>
                {s.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {/* Sections portal-mount header actions here (the fin Refresh button). */}
            <div id="header-actions" className="flex shrink-0 items-center gap-2" />
            <ProfileMenu email={email} dark={dark} setTheme={setTheme} />
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} end={s.end} className={topPill}>
              {s.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* ---------- body: floating rail + content ---------- */}
      <div className="mx-auto flex max-w-[1440px] items-start gap-6 px-4 pb-12 pt-4 sm:px-8">
        {/* Reference-style rail: theme pill on top, sections, sign-out pill at
            the bottom — three separate floating pills. */}
        <aside className="sticky top-24 hidden shrink-0 flex-col gap-3 lg:flex">
          <div className="flex flex-col items-center gap-1 rounded-full bg-surface p-2 shadow-sm">
            <ThemeButtons dark={dark} setTheme={setTheme} />
          </div>

          <div className="flex flex-col items-center gap-1.5 rounded-full bg-surface p-2 shadow-sm">
            {SECTIONS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  cn(
                    "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                    isActive
                      ? "bg-ink text-white dark:bg-accent dark:text-ink"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                  )
                }
              >
                <Icon className="h-5 w-5" />
              </NavLink>
            ))}
          </div>

          <div className="flex flex-col items-center rounded-full bg-surface p-2 shadow-sm">
            <button
              onClick={() => supabase.auth.signOut()}
              title="Sign out"
              className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {title && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
              {app && (
                <div className="flex gap-1 rounded-full bg-slate-100 p-1">
                  {app.items.map(({ to, label, end }) => (
                    <NavLink key={to} to={to} end={end} className={subPill}>
                      {label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
