// Section shell for the Financial Desk. Port of the pre-merge financial-tracker
// App.jsx: owns all fin_ data (one fetch on entry + explicit reload() — the
// verdict changes once a day, so react-query polling would buy nothing here),
// hands it to pages via Outlet context, and mounts the "Refresh now" action
// into the global header via portal.
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Outlet } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { supabase, refreshNow } from "../../lib/supabase";
import { Spinner, Button } from "../../components/ui";

// The fin_ tables carry loose jsonb blobs; the ported pages are plain JSX and
// consume them untyped, so `any` at this boundary is deliberate.
export interface FinContext {
  snap: any;
  cfg: any;
  log: any[];
  cats: any[];
  reload: () => Promise<void>;
}

export default function FinShell() {
  const [snap, setSnap] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [log, setLog] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<Element | null>(null);

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

  // The slot div is committed by Layout before effects run, so this is safe.
  useEffect(() => { setHeaderSlot(document.getElementById("header-actions")); }, []);

  async function doRefresh() {
    setBusy(true);
    try { await refreshNow(); await loadAll(); }
    finally { setBusy(false); }
  }

  const refreshButton = (
    <Button
      variant="secondary"
      onClick={doRefresh}
      loading={busy}
      aria-label="Refresh now"
      className="shrink-0"
    >
      {!busy && <RefreshCw className="h-4 w-4" />}
      <span className="hidden sm:inline">{busy ? "Refreshing…" : "Refresh now"}</span>
    </Button>
  );

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;
  }

  const ctx: FinContext = { snap, cfg, log, cats, reload: loadAll };

  return (
    <>
      {headerSlot && createPortal(refreshButton, headerSlot)}
      <Outlet context={ctx} />
      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        Not investment advice. A monitoring tool that tracks rules you define — it does not predict
        prices. Memory names carry 2×+ beta; daily moves are noise. Verify data before acting.
        {snap?.snapshot_date && <> · Last snapshot {snap.snapshot_date}</>}
      </p>
    </>
  );
}
