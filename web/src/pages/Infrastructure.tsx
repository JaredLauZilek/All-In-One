// Operations hub: every external service the All-In-One tools depend on, in one
// place — what it does, what it costs, its dashboard link, and (where the DB
// can tell us) live health. To register a future service, add an entry to
// SERVICES below; `live` keys map to the health widgets rendered per card.
import { useQuery } from "@tanstack/react-query";
import { Database, Triangle, LineChart, Github, ExternalLink, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Card, CardHeader, DataRow, cn } from "../components/ui";

const SUPABASE_PROJECT = "vjqbircarzxcxrdzlyxj";

interface Service {
  key: string;
  name: string;
  icon: typeof Database;
  iconBg: string;
  role: string;
  plan: string;
  cost: string;
  links: { label: string; href: string }[];
  live?: "supabase";
}

const SERVICES: Service[] = [
  {
    key: "supabase",
    name: "Supabase — project “DRAM”",
    icon: Database,
    iconBg: "bg-emerald-100 text-emerald-600",
    role: "The shared backend: Postgres (fin_* + evs_* tables), auth, edge functions (fin-daily-signal, evs-scan) and the daily pg_cron job.",
    plan: "Free tier · org “Personal Tools” · ap-northeast-2 (Seoul)",
    cost: "$0/mo",
    links: [
      { label: "Project dashboard", href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}` },
      { label: "Edge functions", href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/functions` },
      { label: "Database", href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/database/tables` },
    ],
    live: "supabase",
  },
  {
    key: "vercel",
    name: "Vercel — this app",
    icon: Triangle,
    iconBg: "bg-slate-200 text-slate-700",
    role: "Hosts this single frontend. Push to main on GitHub and Vercel rebuilds and redeploys everything — all tools update together.",
    plan: "Hobby (free) · builds web/ from the repo root",
    cost: "$0/mo",
    links: [{ label: "Vercel dashboard", href: "https://vercel.com/dashboard" }],
  },
  {
    key: "finnhub",
    name: "Finnhub — market data",
    icon: LineChart,
    iconBg: "bg-indigo-100 text-indigo-600",
    role: "US quotes for the daily financial verdict (Yahoo Finance covers 52-week highs, the Korean listings, and the earnings scanner's option chains — keyless). Key lives as a Supabase edge-function secret.",
    plan: "Free tier · US symbols only",
    cost: "$0/mo",
    links: [{ label: "Finnhub dashboard", href: "https://finnhub.io/dashboard" }],
  },
  {
    key: "github",
    name: "GitHub — All-In-One repo",
    icon: Github,
    iconBg: "bg-slate-200 text-slate-700",
    role: "Single repo for everything: this frontend (web/), edge-function sources and the migration ledgers.",
    plan: "Private repo",
    cost: "$0/mo",
    links: [{ label: "JaredLauZilek/All-In-One", href: "https://github.com/JaredLauZilek/All-In-One" }],
  },
];

function useInfraStatus() {
  return useQuery({
    queryKey: ["infra-status"],
    queryFn: async () => {
      const snap = await supabase
        .from("fin_snapshots").select("snapshot_date, created_at")
        .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
      return { snap: snap.data as { snapshot_date: string; created_at: string } | null };
    },
    refetchInterval: 60000,
  });
}

export default function Infrastructure() {
  const { data } = useInfraStatus();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Total running cost</p>
            <p className="mt-0.5 text-2xl font-semibold text-slate-900">$0/mo</p>
          </div>
          {/* full-width line on phones; right-aligned aside on sm+ */}
          <p className="basis-full text-xs text-slate-400 sm:ml-auto sm:basis-auto sm:max-w-xs sm:text-right">
            Everything rides free tiers since the Fly.io worker was retired with the Restock Monitor (2026-08-29).
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {SERVICES.map((s) => (
          <ServiceCard key={s.key} service={s} data={data} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-slate-400">
        Adding a new tool or subscription later? Register it in the SERVICES list in{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">web/src/pages/Infrastructure.tsx</code> so this page
        stays the one place to see everything you're running.
      </p>
    </div>
  );
}

function ServiceCard({ service, data }: { service: Service; data: ReturnType<typeof useInfraStatus>["data"] }) {
  const Icon = service.icon;
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={service.name}
        subtitle={service.plan}
        action={
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-medium text-slate-600">
            {service.cost}
          </span>
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        <div className="flex gap-3">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", service.iconBg)}>
            <Icon className="h-4.5 w-4.5" />
          </div>
          <p className="text-sm leading-relaxed text-slate-600">{service.role}</p>
        </div>

        {service.live === "supabase" && <SupabaseHealth snap={data?.snap ?? null} />}

        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3">
          {service.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              {l.label} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SupabaseHealth({ snap }: { snap: { snapshot_date: string; created_at: string } | null }) {
  // The daily cron writes one fin_snapshots row per day; a fresh row is the
  // cheapest end-to-end proof that cron + edge functions + DB are all alive.
  const ageDays = snap ? Math.floor((Date.now() - new Date(snap.snapshot_date + "T00:00:00Z").getTime()) / 86400000) : null;
  const ok = ageDays !== null && ageDays <= 1;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3.5 py-3">
      <DataRow
        label="Daily signal cron"
        value={snap ? `Last snapshot ${snap.snapshot_date}` : "No snapshot yet"}
        tone={ok ? "good" : "warn"}
      />
      <DataRow label="Auth + edge functions" value="In use by this app" tone="good" />
    </div>
  );
}
