// Sidebar shell — mirrors lazada-monitor/web/src/components/Layout.tsx.
// Difference by design: this app has no auth, so the sidebar footer carries the
// data-source note instead of an email + sign-out.
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Gauge, SlidersHorizontal, LineChart, RefreshCw } from "lucide-react";
import { cn, Button } from "./ui";

const NAV = [
  { to: "/", label: "Desk", icon: Gauge },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];

const TITLES = {
  "/": "Desk",
  "/settings": "Settings",
};

export default function Layout({ onRefresh, busy, lastDate, context }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900">
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

      <div className="ml-60 flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/80 px-8 py-4 backdrop-blur">
          <h1 className="text-lg font-semibold text-slate-900">{TITLES[pathname] ?? "Financial Tracker"}</h1>
          <Button variant="secondary" onClick={onRefresh} loading={busy}>
            {!busy && <RefreshCw className="h-4 w-4" />}
            {busy ? "Refreshing…" : "Refresh now"}
          </Button>
        </header>

        <main className="flex-1 p-8">
          <Outlet context={context} />
        </main>

        <footer className="px-8 pb-8">
          <p className="text-xs leading-relaxed text-slate-400">
            Not investment advice. A monitoring tool that tracks rules you define — it does not predict
            prices. Memory names carry 2×+ beta; daily moves are noise. Verify data before acting.
          </p>
        </footer>
      </div>
    </div>
  );
}
