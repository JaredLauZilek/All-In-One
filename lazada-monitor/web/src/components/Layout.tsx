// Sidebar shell — mirrors financial-tracker/src/components/Layout.jsx.
//
// Responsive: below lg the sidebar is an off-canvas drawer behind a hamburger;
// at lg+ it is static and the hamburger disappears. Keep the two apps' shells
// in step — if you change the drawer here, change it there too.
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, Bell, Settings, LogOut, Radar, Menu } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Package },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/products": "Products",
  "/notifications": "Notifications",
  "/settings": "Settings",
};

export default function Layout({ email }: { email: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Close on navigation — covers browser back/forward and programmatic nav.
  // NavLink also closes onClick, because tapping the route you're ALREADY on
  // doesn't change pathname, so this effect alone would leave the drawer open.
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
            <Radar className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Restock Monitor</p>
            <p className="text-[11px] text-slate-400">Lazada · Telegram alerts</p>
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
          <p className="truncate text-xs text-slate-400">{email}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 lg:ml-60">
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
          <h1 className="truncate text-lg font-semibold text-slate-900">{TITLES[pathname] ?? "Restock Monitor"}</h1>
        </header>
        <main className="p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
