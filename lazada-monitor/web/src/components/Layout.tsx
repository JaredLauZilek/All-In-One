import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, Bell, Settings, LogOut, Radar } from "lucide-react";
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
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900">
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
      <div className="ml-60 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 px-8 py-4 backdrop-blur">
          <h1 className="text-lg font-semibold text-slate-900">{TITLES[pathname] ?? "Restock Monitor"}</h1>
        </header>
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
