import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Infrastructure from "./pages/Infrastructure";
import FinShell, { type FinContext } from "./apps/fin/FinShell";
import FinDesk from "./apps/fin/Desk";
import FinNews from "./apps/fin/News";
import FinSettings from "./apps/fin/Settings";
import LzdDashboard from "./apps/lzd/Dashboard";
import LzdProducts from "./apps/lzd/Products";
import LzdNotifications from "./apps/lzd/Notifications";
import LzdSettings from "./apps/lzd/Settings";
import EvsScanner from "./apps/evs/Scanner";
import EvsTrades from "./apps/evs/Trades";
import EvsSettings from "./apps/evs/Settings";
import { Spinner } from "./components/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 30000, staleTime: 10000 } },
});

// Invalidate restock-monitor queries when the worker writes to the DB, so the
// dashboard updates live. Global on purpose: subscribing once is cheap, and it
// keeps working while you're on other tools' pages.
function RealtimeBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("lzd-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "lzd_products" }, () => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lzd_notifications" }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
  return null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!session) return <Login />;

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout email={session.user.email ?? ""} />}>
            <Route path="/" element={<Home />} />
            <Route path="/infra" element={<Infrastructure />} />
            {/* Financial Desk — FinShell owns the section's data + Refresh action */}
            <Route path="/fin" element={<FinShell />}>
              <Route index element={<FinDeskRoute />} />
              <Route path="news" element={<FinNewsRoute />} />
              <Route path="settings" element={<FinSettingsRoute />} />
            </Route>
            {/* Restock Monitor — pages self-fetch via react-query */}
            <Route path="/lzd" element={<LzdDashboard />} />
            <Route path="/lzd/products" element={<LzdProducts />} />
            <Route path="/lzd/notifications" element={<LzdNotifications />} />
            <Route path="/lzd/settings" element={<LzdSettings />} />
            {/* Earnings Vol Scanner — pages self-fetch; the scan runs in the
                evs-scan edge function */}
            <Route path="/evs" element={<EvsScanner />} />
            <Route path="/evs/trades" element={<EvsTrades />} />
            <Route path="/evs/settings" element={<EvsSettings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// FinShell provides its data through Outlet context; these thin routes unpack it
// for the ported (plain-JSX) financial pages.
function FinDeskRoute() {
  const { snap, log, cats, cfg } = useOutletContext<FinContext>();
  return <FinDesk snap={snap} log={log} cats={cats} cfg={cfg} />;
}

function FinNewsRoute() {
  const { snap } = useOutletContext<FinContext>();
  return <FinNews news={snap?.news} lastDate={snap?.snapshot_date} />;
}

function FinSettingsRoute() {
  const { cfg, log, cats, reload, snap } = useOutletContext<FinContext>();
  // prices carries each ticker's currency — Settings needs it so the peak
  // column and level inputs are labelled in the right currency, not always "$".
  return <FinSettings cfg={cfg} log={log} cats={cats} reload={reload} intel={snap?.intel} prices={snap?.prices} />;
}
