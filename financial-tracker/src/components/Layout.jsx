// Sidebar shell — mirrors lazada-monitor/web/src/components/Layout.tsx.
// Difference by design: this app has no auth, so the sidebar footer carries the
// data-source note instead of an email + sign-out.
//
// Responsive: below lg the sidebar is an off-canvas drawer behind a hamburger;
// at lg+ it is static and the hamburger disappears. Keep the two apps' shells
// in step — if you change the drawer here, change it there too.
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Gauge, SlidersHorizontal, LineChart, RefreshCw, Newspaper, Menu } from "lucide-react";
import { cn, Button } from "./ui";

const NAV = [
  { to: "/", label: "Desk", icon: Gauge },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];

const TITLES = {
  "/": "Desk",
  "/news": "News",
  "/settings": "Settings",
};

export default function Layout({ onRefresh, busy, lastDate, context }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Close on navigation — covers browser back/forward and programmatic nav.
  // NavLink also closes onClick, because tapping the route you're ALREADY on
  // doesn't change pathname, so this effect alone would leave the drawer
  // sitting open over the page you just asked for.
  useEffect(() => { setOpen(false); }, [pathname]);

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
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <LineChart className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Financial Tracker</p>
            <p className="text-[11px] text-slate-400">Memory cycle signal</p>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )
              }
            >
              <Icon className="h-4.5 w-4.5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <p className="text-xs text-slate-400">Finnhub · Yahoo · TrendForce</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {lastDate ? `Last snapshot ${lastDate}` : "No snapshot yet"}
          </p>
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
          <h1 className="truncate text-lg font-semibold text-slate-900">{TITLES[pathname] ?? "Financial Tracker"}</h1>
          <Button
            variant="secondary"
            onClick={onRefresh}
            loading={busy}
            aria-label="Refresh now"
            className="ml-auto shrink-0"
          >
            {!busy && <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">{busy ? "Refreshing…" : "Refresh now"}</span>
          </Button>
        </header>

        <main className="flex-1 p-4 sm:p-8">
          <Outlet context={context} />
        </main>

        <footer className="px-4 pb-8 sm:px-8">
          <p className="text-xs leading-relaxed text-slate-400">
            Not investment advice. A monitoring tool that tracks rules you define — it does not predict
            prices. Memory names carry 2×+ beta; daily moves are noise. Verify data before acting.
          </p>
        </footer>
      </div>
    </div>
  );
}
