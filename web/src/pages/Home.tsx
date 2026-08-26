// The launcher. One tile per tool — add a tile here when a new tool joins the
// suite. Tiles show a one-line live status so a glance tells you whether
// anything needs attention without opening the tool.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { LineChart, Radar, Server, ArrowRight, CandlestickChart } from "lucide-react";
import { supabase, WORKER_STALE_SECS, type WorkerState } from "../lib/supabase";
import { Card, StatusBadge, cn } from "../components/ui";

function useHomeStatus() {
  return useQuery({
    queryKey: ["home-status"],
    queryFn: async () => {
      const [snap, products, worker, evs] = await Promise.all([
        supabase.from("fin_snapshots").select("snapshot_date, verdict").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("lzd_products").select("stock_status, is_active"),
        supabase.from("lzd_worker_state").select("*").maybeSingle(),
        supabase.from("evs_trades").select("status"),
      ]);
      return {
        snap: snap.data as { snapshot_date: string; verdict: string } | null,
        products: (products.data ?? []) as { stock_status: string; is_active: boolean }[],
        worker: worker.data as WorkerState | null,
        evsTrades: (evs.data ?? []) as { status: string }[],
      };
    },
  });
}

export default function Home() {
  const { data } = useHomeStatus();

  const beat = data?.worker?.last_heartbeat_at ? new Date(data.worker.last_heartbeat_at).getTime() : 0;
  const workerOnline = beat ? (Date.now() - beat) / 1000 <= WORKER_STALE_SECS : false;
  const active = data?.products.filter((p) => p.is_active) ?? [];
  const inStock = active.filter((p) => p.stock_status === "in_stock").length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Your tools</h2>
        <p className="mt-1 text-sm text-slate-500">
          Everything lives in this one app — one URL, one deploy, one place to check.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppTile
          to="/fin"
          icon={<LineChart className="h-6 w-6 text-white" />}
          iconBg="bg-indigo-500"
          name="Financial Desk"
          description="Memory-cycle signal for MU, SNDK, WDC & co. One verdict a day; defaults to Hold."
          status={
            data?.snap ? (
              <span className="flex items-center gap-2">
                <StatusBadge status={data.snap.verdict} />
                <span className="text-xs text-slate-400">snapshot {data.snap.snapshot_date}</span>
              </span>
            ) : (
              <span className="text-xs text-slate-400">No snapshot yet</span>
            )
          }
        />
        <AppTile
          to="/lzd"
          icon={<Radar className="h-6 w-6 text-white" />}
          iconBg="bg-emerald-500"
          name="Restock Monitor"
          description="Watches Lazada product pages and pings Telegram the moment stock returns."
          status={
            data ? (
              <span className="flex items-center gap-2 text-xs">
                <span className={cn("inline-flex h-2 w-2 rounded-full", workerOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                <span className={workerOnline ? "text-emerald-600" : "text-red-600"}>
                  {workerOnline ? "Worker online" : "Worker down"}
                </span>
                <span className="text-slate-400">
                  · {active.length} watched · {inStock} in stock
                </span>
              </span>
            ) : (
              <span className="text-xs text-slate-400">Loading…</span>
            )
          }
        />
        <AppTile
          to="/evs"
          icon={<CandlestickChart className="h-6 w-6 text-white" />}
          iconBg="bg-amber-500"
          name="Earnings Vol Scanner"
          description="Checks a ticker's upcoming earnings against the three-filter calendar-spread strategy."
          status={
            data ? (
              <span className="text-xs text-slate-400">
                {data.evsTrades.length} play{data.evsTrades.length === 1 ? "" : "s"} logged
                {" · "}{data.evsTrades.filter((t) => t.status === "open").length} open
              </span>
            ) : (
              <span className="text-xs text-slate-400">Loading…</span>
            )
          }
        />
        <AppTile
          to="/infra"
          icon={<Server className="h-6 w-6 text-white" />}
          iconBg="bg-slate-700"
          name="Infrastructure"
          description="Every service behind these tools — subscriptions, deploys, dashboards, costs."
          status={
            data?.worker?.last_heartbeat_at ? (
              <span className="text-xs text-slate-400">
                Worker heartbeat {formatDistanceToNow(new Date(data.worker.last_heartbeat_at), { addSuffix: true })}
              </span>
            ) : (
              <span className="text-xs text-slate-400">Supabase · Fly.io · Vercel · Telegram</span>
            )
          }
        />
      </div>
    </div>
  );
}

function AppTile({ to, icon, iconBg, name, description, status }: {
  to: string;
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  description: string;
  status: React.ReactNode;
}) {
  return (
    <Link to={to} className="group block">
      <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl shadow-sm", iconBg)}>{icon}</div>
          <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900 group-hover:text-indigo-600">{name}</h3>
        <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-500">{description}</p>
        <div className="mt-4 border-t border-slate-100 pt-3">{status}</div>
      </Card>
    </Link>
  );
}
