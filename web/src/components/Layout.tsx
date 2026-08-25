// The one sidebar shell for all of All-In-One. Nav is grouped per tool; every
// tool's pages render inside this same chrome so the whole thing reads as one
// product (light SaaS: slate-50 page, white cards, dark slate-900 sidebar,
// indigo primary).
//
// Responsive: below lg the sidebar is an off-canvas drawer behind a hamburger;
// at lg+ it is static and the hamburger disappears.
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes, Home, LogOut, Menu, Server,
  Gauge, Newspaper, SlidersHorizontal,
  LayoutDashboard, Package, Bell, Settings as SettingsIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "./ui";

const NAV_GROUPS: { label: string | null; items: { to: string; label: string; icon: typeof Home; end?: boolean }[] }[] = [
  {
    label: null,
    items: [{ to: "/", label: "Home", icon: Home, end: true }],
  },
  {
    label: "Financial Desk",
    items: [
      { to: "/fin", label: "Desk", icon: Gauge, end: true },
      { to: "/fin/news", label: "News", icon: Newspaper },
      { to: "/fin/settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Restock Monitor",
    items: [
      { to: "/lzd", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/lzd/products", label: "Products", icon: Package },
      { to: "/lzd/notifications", label: "Notifications", icon: Bell },
      { to: "/lzd/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
  {
    label: "Operations",
    items: [{ to: "/infra", label: "Infrastructure", icon: Server }],
  },
];

const TITLES: Record<string, string> = {
  "/": "Home",
  "/fin": "Financial Desk",
  "/fin/news": "Financial Desk · News",
  "/fin/settings": "Financial Desk · Settings",
  "/lzd": "Restock Monitor",
  "/lzd/products": "Restock Monitor · Products",
  "/lzd/notifications": "Restock Monitor · Notifications",
  "/lzd/settings": "Restock Monitor · Settings",
  "/infra": "Infrastructure",
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
        <NavLink to="/" className="flex items-center gap-2.5 px-5 py-5" onClick={() => setOpen(false)}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">All-In-One</p>
            <p className="text-[11px] text-slate-400">Personal tools</p>
          </div>
        </NavLink>
        <nav className="mt-1 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
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
              </div>
            </div>
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
