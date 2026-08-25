// Operations hub: every external service the All-In-One tools depend on, in one
// place — what it does, what it costs, its dashboard link, and (where the DB
// can tell us) live health. To register a future service, add an entry to
// SERVICES below; `live` keys map to the health widgets rendered per card.
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Database, Plane, Triangle, Send, LineChart, Github, ExternalLink, Wallet,
} from "lucide-react";
import { supabase, WORKER_STALE_SECS, BOT_USERNAME, type WorkerState, type Settings } from "../lib/supabase";
import { Card, CardHeader, DataRow, cn } from "../components/ui";

const SUPABASE_PROJECT = "vjqbircarzxcxrdzlyxj";
// Fly's published price for the worker's preset (shared-cpu-4x, 1GB base RAM
// included). Keep in step with worker/fly.toml; Fly's dashboard is the billing
// source of truth — this is a sanity check, not an invoice.
const FLY_USD_PER_MONTH = 7.78;

interface Service {
  key: string;
  name: string;
  icon: typeof Database;
  iconBg: string;
  role: string;
  plan: string;
  cost: string;
  links: { label: string; href: string }[];
  live?: "supabase" | "fly" | "telegram";
}

const SERVICES: Service[] = [
  {
    key: "supabase",
    name: "Supabase — project “DRAM”",
    icon: Database,
    iconBg: "bg-emerald-100 text-emerald-600",
    role: "The shared backend: Postgres (fin_* + lzd_* tables), auth, realtime, edge functions (fin-daily-signal, lzd-telegram-webhook) and pg_cron jobs.",
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
    key: "fly",
    name: "Fly.io — lazada-monitor-worker",
    icon: Plane,
    iconBg: "bg-violet-100 text-violet-600",
    role: "Playwright + Chromium worker that actually checks Lazada stock (a real browser is the only reliable signal) and sends the Telegram restock alerts.",
    plan: "1 machine · shared-cpu-4x · Singapore (sin)",
    cost: `~$${FLY_USD_PER_MONTH.toFixed(2)}/mo`,
    links: [
      { label: "App dashboard", href: "https://fly.io/apps/lazada-monitor-worker" },
      { label: "Billing", href: "https://fly.io/dashboard/personal/billing" },
    ],
    live: "fly",
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
    key: "telegram",
    name: `Telegram — @${BOT_USERNAME}`,
    icon: Send,
    iconBg: "bg-sky-100 text-sky-600",
    role: "Delivers restock alerts and answers /list, /pause, /resume. Webhook lands on the lzd-telegram-webhook edge function.",
    plan: "Bot API",
    cost: "$0/mo",
    links: [{ label: "Open bot", href: `https://t.me/${BOT_USERNAME}` }],
    live: "telegram",
  },
  {
    key: "finnhub",
    name: "Finnhub — market data",
    icon: LineChart,
    iconBg: "bg-indigo-100 text-indigo-600",
    role: "US quotes for the daily financial verdict (Yahoo Finance covers 52-week highs and the Korean listings, keyless). Key lives as a Supabase edge-function secret.",
    plan: "Free tier · US symbols only",
    cost: "$0/mo",
    links: [{ label: "Finnhub dashboard", href: "https://finnhub.io/dashboard" }],
  },
  {
    key: "github",
    name: "GitHub — All-In-One repo",
    icon: Github,
    iconBg: "bg-slate-200 text-slate-700",
    role: "Single repo for everything: this frontend (web/), the Fly worker, edge-function sources and the migration ledger.",
    plan: "Private repo",
    cost: "$0/mo",
    links: [{ label: "JaredLauZilek/All-In-One", href: "https://github.com/JaredLauZilek/All-In-One" }],
  },
];

function useInfraStatus() {
  return useQuery({
    queryKey: ["infra-status"],
    queryFn: async () => {
      const [worker, settings, snap] = await Promise.all([
        supabase.from("lzd_worker_state").select("*").maybeSingle(),
        supabase.from("lzd_settings").select("telegram_chat_id, telegram_username").maybeSingle(),
        supabase.from("fin_snapshots").select("snapshot_date, created_at").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        worker: worker.data as WorkerState | null,
        settings: settings.data as Pick<Settings, "telegram_chat_id" | "telegram_username"> | null,
        snap: snap.data as { snapshot_date: string; created_at: string } | null,
      };
    },
    refetchInterval: 15000,
  });
}

export default function Infrastructure() {
  const { data } = useInfraStatus();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Total running cost</p>
            <p className="mt-0.5 text-2xl font-semibold text-slate-900">~${FLY_USD_PER_MONTH.toFixed(2)}/mo</p>
          </div>
          <p className="ml-auto max-w-xs text-right text-xs text-slate-400">
            The Fly worker is the only paid piece — everything else rides free tiers.
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

        {service.live === "fly" && <FlyHealth worker={data?.worker ?? null} />}
        {service.live === "supabase" && <SupabaseHealth snap={data?.snap ?? null} />}
        {service.live === "telegram" && <TelegramHealth settings={data?.settings ?? null} />}

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

/* ---------- live health widgets (all read straight from the DB) ---------- */

function FlyHealth({ worker }: { worker: WorkerState | null }) {
  const beat = worker?.last_heartbeat_at ? new Date(worker.last_heartbeat_at).getTime() : 0;
  const ageSecs = beat ? (Date.now() - beat) / 1000 : Infinity;
  const online = ageSecs <= WORKER_STALE_SECS;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3.5 py-3">
      <DataRow
        label="Worker"
        value={!beat ? "Never started" : online ? "Online" : "Stale — check fly logs"}
        tone={!beat ? "bad" : online ? "good" : "bad"}
      />
      {worker?.started_at && (
        <DataRow label="Up since" value={formatDistanceToNow(new Date(worker.started_at), { addSuffix: true })} />
      )}
      {worker && <DataRow label="Checks completed" value={worker.checks_completed.toLocaleString()} />}
    </div>
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
      <DataRow label="Realtime + auth" value="In use by this app" tone="good" />
    </div>
  );
}

function TelegramHealth({ settings }: { settings: Pick<Settings, "telegram_chat_id" | "telegram_username"> | null }) {
  const linked = !!settings?.telegram_chat_id;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3.5 py-3">
      <DataRow
        label="Account link"
        value={linked ? `Connected${settings?.telegram_username ? ` as @${settings.telegram_username}` : ""}` : "Not linked"}
        tone={linked ? "good" : "warn"}
      />
    </div>
  );
}
