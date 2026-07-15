import { useEffect, useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, useOutletContext } from "react-router-dom";
import { supabase, refreshNow } from "./lib/supabase";
import Layout from "./components/Layout";
import Desk from "./pages/Desk";
import News from "./pages/News";
import Settings from "./pages/Settings";
import { Spinner } from "./components/ui";

// The app is small enough that one fetch-on-mount + explicit reload() beats
// react-query (which the sibling app needs for its 30s polling). The verdict
// changes once a day; there is nothing to poll.
export default function App() {
  const [snap, setSnap] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [log, setLog] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: s }, { data: c }, { data: l }, { data: k }] = await Promise.all([
      supabase.from("fin_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("fin_app_config").select("*").eq("id", 1).maybeSingle(),
      supabase.from("fin_contract_log").select("*").order("logged_at", { ascending: false }),
      supabase.from("fin_catalysts").select("*").order("event_date", { ascending: true, nullsFirst: false }),
    ]);
    setSnap(s); setCfg(c); setLog(l ?? []); setCats(k ?? []); setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function doRefresh() {
    setBusy(true);
    try { await refreshNow(); await loadAll(); }
    finally { setBusy(false); }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }

  const ctx = { snap, cfg, log, cats, reload: loadAll };

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout onRefresh={doRefresh} busy={busy} lastDate={snap?.snapshot_date} context={ctx} />}>
          <Route path="/" element={<DeskRoute />} />
          <Route path="/news" element={<NewsRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

// Layout renders its own <Outlet/>; these thin routes read the context it provides.
function DeskRoute() {
  const { snap, log, cats, cfg } = useOutletContext();
  return <Desk snap={snap} log={log} cats={cats} cfg={cfg} />;
}

function NewsRoute() {
  const { snap } = useOutletContext();
  return <News news={snap?.news} lastDate={snap?.snapshot_date} />;
}

function SettingsRoute() {
  const { cfg, log, cats, reload, snap } = useOutletContext();
  // prices carries each ticker's currency — Settings needs it so the peak
  // column and level inputs are labelled in the right currency, not always "$".
  return <Settings cfg={cfg} log={log} cats={cats} reload={reload} intel={snap?.intel} prices={snap?.prices} />;
}
