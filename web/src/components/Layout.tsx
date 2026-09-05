// The one shell for all of All-In-One, styled after the "Finexy" reference:
// warm canvas, TOP nav with pill tabs (active = ink pill), a floating icon
// rail on the left (lg+) with the same sections + sign-out, and in-content
// pill tabs for the active mini-app's sub-pages. No drawer/sidebar anymore.
//
// Add a new mini-app: one entry in APPS (name/icon/items) — the top nav, rail,
// sub-tabs and titles all derive from it.
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes, Home, LogOut, Server, LineChart, CandlestickChart,
  Gauge, Newspaper, SlidersHorizontal, Crosshair, NotebookPen,
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
    isActive ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100",
  );

const subPill = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
    isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
  );

export default function Layout({ email }: { email: string }) {
  const { pathname } = useLocation();
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
          <nav className="mx-auto hidden items-center gap-1 rounded-full bg-white p-1.5 shadow-sm md:flex">
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.end} className={topPill}>
                {s.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {/* Sections portal-mount header actions here (the fin Refresh button). */}
            <div id="header-actions" className="flex shrink-0 items-center gap-2" />
            <div className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3 shadow-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-bold uppercase text-accent">
                {email.slice(0, 1) || "?"}
              </span>
              <span className="hidden max-w-[16ch] truncate text-xs font-medium text-slate-600 xl:block">{email}</span>
              <button
                onClick={() => supabase.auth.signOut()}
                title="Sign out"
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
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
        <aside className="sticky top-24 hidden shrink-0 lg:block">
          <div className="flex flex-col items-center gap-1.5 rounded-full bg-white p-2 shadow-sm">
            {SECTIONS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  cn(
                    "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                    isActive ? "bg-ink text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                  )
                }
              >
                <Icon className="h-5 w-5" />
              </NavLink>
            ))}
            <div className="my-1 h-px w-6 bg-slate-200" />
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
