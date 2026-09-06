import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import Home from "./pages/Home";
import Infrastructure from "./pages/Infrastructure";
import FinShell, { type FinContext } from "./apps/fin/FinShell";
import FinDesk from "./apps/fin/Desk";
import FinNews from "./apps/fin/News";
import FinSettings from "./apps/fin/Settings";
import EvsScanner from "./apps/evs/Scanner";
import EvsTrades from "./apps/evs/Trades";
import EvsSettings from "./apps/evs/Settings";
import TrainingDashboard from "./apps/training/Dashboard";
import TrainingRaces from "./apps/training/Races";
import TrainingSettings from "./apps/training/Settings";
import { Spinner } from "./components/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 30000, staleTime: 10000 } },
});

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

  // /privacy is deliberately OUTSIDE the auth gate — Google's OAuth consent
  // screen links to it and may fetch it anonymously.
  if (window.location.pathname === "/privacy") return <Privacy />;

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!session) return <Login />;

  return (
    <QueryClientProvider client={queryClient}>
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
            {/* Earnings Vol Scanner — pages self-fetch; the scan runs in the
                evs-scan edge function */}
            <Route path="/evs" element={<EvsScanner />} />
            <Route path="/evs/trades" element={<EvsTrades />} />
            <Route path="/evs/settings" element={<EvsSettings />} />
            {/* Training — pages self-fetch; plan/sync/bot run in tr-* edge fns */}
            <Route path="/training" element={<TrainingDashboard />} />
            <Route path="/training/races" element={<TrainingRaces />} />
            <Route path="/training/settings" element={<TrainingSettings />} />
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
