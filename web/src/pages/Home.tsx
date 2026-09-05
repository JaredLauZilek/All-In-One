// The launcher. One tile per tool — add a tile here when a new tool joins the
// suite. Tiles show a one-line live status so a glance tells you whether
// anything needs attention without opening the tool.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Server, ArrowRight, CandlestickChart, Dumbbell } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Card, StatusBadge, cn } from "../components/ui";

function useHomeStatus() {
  return useQuery({
    queryKey: ["home-status"],
    queryFn: async () => {
      const [snap, evs, race] = await Promise.all([
        supabase.from("fin_snapshots").select("snapshot_date, verdict").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("evs_trades").select("status"),
        supabase.from("tr_races").select("name, race_date").eq("status", "upcoming")
          .order("race_date", { ascending: true, nullsFirst: false }).limit(1).maybeSingle(),
      ]);
      return {
        snap: snap.data as { snapshot_date: string; verdict: string } | null,
        evsTrades: (evs.data ?? []) as { status: string }[],
        race: race.data as { name: string; race_date: string | null } | null,
      };
    },
  });
}

export default function Home() {
  const { data } = useHomeStatus();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-slate-900">{greeting}, Jared</h2>
        <p className="mt-2 text-[15px] text-slate-500">
          Everything lives in this one app — one URL, one deploy, one place to check.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppTile
          to="/fin"
          icon={<LineChart className="h-6 w-6 text-accent" />}
          iconBg="bg-gradient-to-br from-forest-600 to-forest-950"
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
          to="/evs"
          icon={<CandlestickChart className="h-6 w-6 text-ink" />}
          iconBg="bg-accent"
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
          to="/training"
          icon={<Dumbbell className="h-6 w-6 text-white" />}
          iconBg="bg-indigo-600"
          name="Training"
          description="Hyrox + endurance training hub — weekly plans, Strava/Hevy sync, Telegram coach."
          status={
            data?.race ? (
              <span className="text-xs text-slate-400">
                {data.race.name}
                {data.race.race_date
                  ? ` in ${Math.max(0, Math.ceil((new Date(data.race.race_date + "T00:00:00").getTime() - Date.now()) / 86400000))} days`
                  : " — date TBC"}
              </span>
            ) : (
              <span className="text-xs text-slate-400">No race on the calendar</span>
            )
          }
        />
        <AppTile
          to="/infra"
          icon={<Server className="h-6 w-6 text-white" />}
          iconBg="bg-ink"
          name="Infrastructure"
          description="Every service behind these tools — subscriptions, deploys, dashboards, costs."
          status={<span className="text-xs text-slate-400">Supabase · Vercel · Finnhub · GitHub</span>}
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
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", iconBg)}>{icon}</div>
          <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900 group-hover:text-indigo-600">{name}</h3>
        <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-500">{description}</p>
        <div className="mt-4 border-t border-slate-100 pt-3">{status}</div>
      </Card>
    </Link>
  );
}
