// The one sidebar shell for all of All-In-One. Each mini-app is a
// click-to-reveal group (accordion) so the nav stays tidy as more apps join —
// add a new app to APPS and its pages render inside this same chrome (light
// SaaS: slate-50 page, white cards, dark slate-900 sidebar, indigo primary).
//
// Responsive: below lg the sidebar is an off-canvas drawer behind a hamburger;
// at lg+ it is static and the hamburger disappears.
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes, Home, LogOut, Menu, Server, ChevronDown, LineChart, CandlestickChart,
  Gauge, Newspaper, SlidersHorizontal, Crosshair, NotebookPen,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "./ui";

// One entry per mini-app. `base` doubles as the group's identity for the
// open/closed state and as the prefix that auto-expands the group when a route
// inside it is active.
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

const TITLES: Record<string, string> = {
  "/": "Home",
  "/fin": "Financial Desk",
  "/fin/news": "Financial Desk · News",
  "/fin/settings": "Financial Desk · Settings",
  "/evs": "Earnings Vol Scanner",
  "/evs/trades": "Earnings Vol · Trades",
  "/evs/settings": "Earnings Vol · Settings",
  "/infra": "Infrastructure",
};

const OPEN_GROUPS_KEY = "aio:nav-open";

function loadOpenGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
  );

export default function Layout({ email }: { email: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // Manual open/closed overrides per app group, persisted so the nav comes
  // back the way you left it. A group with no override auto-opens while a
  // route inside it is active.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);

  // Close the drawer on navigation — covers browser back/forward and
  // programmatic nav. NavLink also closes onClick, because tapping the route
  // you're ALREADY on doesn't change pathname, so this effect alone would
  // leave the drawer open.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Entering an app (Home tile, deep link, back/forward) always reveals its
  // tabs, even if the group was manually collapsed earlier.
  useEffect(() => {
    const app = APPS.find((a) => pathname.startsWith(a.base));
    if (app) {
      setOpenGroups((g) => {
        if (g[app.base] === false) {
          const next = { ...g, [app.base]: true };
          try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        }
        return g;
      });
    }
  }, [pathname]);

  function toggleGroup(base: string, current: boolean) {
    setOpenGroups((g) => {
      const next = { ...g, [base]: !current };
      try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavLink to="/" className="flex items-center gap-2.5 px-5 py-5" onClick={() => setOpen(false)}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">All-In-One</p>
            <p className="text-[11px] text-slate-400">Personal tools</p>
          </div>
        </NavLink>

        <nav className="mt-1 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <NavLink to="/" end onClick={() => setOpen(false)} className={linkClass}>
            <Home className="h-4.5 w-4.5" />
            Home
          </NavLink>

          {APPS.map((app) => {
            const active = pathname.startsWith(app.base);
            const expanded = openGroups[app.base] ?? active;
            const AppIcon = app.icon;
            return (
              <div key={app.base}>
                <button
                  type="button"
                  onClick={() => toggleGroup(app.base, expanded)}
                  aria-expanded={expanded}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    // The header lights up when its app is active but collapsed,
                    // so the current app stays findable in a folded nav.
                    active && !expanded ? "bg-slate-800/70 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                  )}
                >
                  <AppIcon className="h-4.5 w-4.5" />
                  {app.name}
                  <ChevronDown
                    className={cn("ml-auto h-4 w-4 text-slate-500 transition-transform", expanded ? "rotate-0" : "-rotate-90")}
                  />
                </button>
                {expanded && (
                  <div className="mt-1 space-y-1 border-l border-slate-800 pl-3 ml-5 mb-1">
                    {app.items.map(({ to, label, icon: Icon, end }) => (
                      <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={linkClass}>
                        <Icon className="h-4 w-4" />
                        {label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <NavLink to="/infra" onClick={() => setOpen(false)} className={linkClass}>
            <Server className="h-4.5 w-4.5" />
            Infrastructure
          </NavLink>
        </nav>

        <div className="border-t border-slate-800 p-4">
          <p className="truncate text-xs text-slate-400">{email}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col lg:ml-60">
        {/* z-20, NOT z-30: the backdrop is z-30 and both sit in the root stacking
            context, so a tie would let this header paint over the backdrop and
            stay clickable. Order must be aside 40 > backdrop 30 > header 20. */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-4 backdrop-blur sm:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-semibold text-slate-900">{TITLES[pathname] ?? "All-In-One"}</h1>
          {/* Sections can portal-mount header actions here (the fin Refresh button). */}
          <div id="header-actions" className="ml-auto flex shrink-0 items-center gap-2" />
        </header>

        <main className="flex-1 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
