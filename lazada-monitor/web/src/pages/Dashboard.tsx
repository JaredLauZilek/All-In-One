import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Package, CheckCircle2, XCircle, BellRing, Activity } from "lucide-react";
import {
  supabase, fmtPrice, WORKER_STALE_SECS,
  type Product, type Notification, type WorkerState,
} from "../lib/supabase";
import { Card, CardHeader, StatCard, StatusBadge, Spinner, EmptyState } from "../components/ui";

async function loadDashboard() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [products, notifs, checks] = await Promise.all([
    supabase.from("lzd_products").select("*").order("last_status_change_at", { ascending: false, nullsFirst: false }),
    supabase.from("lzd_notifications").select("*, product:lzd_products(title,url)").gte("created_at", since).order("created_at", { ascending: false }),
    supabase.from("lzd_checks").select("status, fetch_method, checked_at, latency_ms").order("checked_at", { ascending: false }).limit(50),
  ]);
  return {
    products: (products.data ?? []) as Product[],
    notifs: (notifs.data ?? []) as Notification[],
    checks: checks.data ?? [],
  };
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: loadDashboard });
  if (isLoading || !data) return <Spinner />;

  const { products, notifs, checks } = data;
  const inStock = products.filter((p) => p.stock_status === "in_stock").length;
  const outStock = products.filter((p) => p.stock_status === "out_of_stock").length;
  const recentChanges = products.filter((p) => p.last_status_change_at).slice(0, 8);

  // Stats are computed over browser checks only. Rows from the retired HTTP checker are
  // excluded: their statuses were unreliable (it reported in_stock unconditionally) and
  // its fetch tiers no longer exist, so mixing them in would be misleading.
  //
  // Windowed by TIME, not by count. These numbers are a live health canary, and a
  // count-based window silently stretches as the interval grows: 50 checks is ~50min at a
  // 60s interval but ~4 HOURS at 5min, so a recovering monitor still showed its burnt
  // history and looked broken. An hour means an hour regardless of interval.
  const sinceMs = Date.now() - 60 * 60 * 1000;
  const browserChecks = checks.filter(
    (c) => c.fetch_method === "browser" && new Date(c.checked_at).getTime() >= sinceMs,
  );
  const lastCheck = browserChecks[0]?.checked_at;
  const blockedRate = browserChecks.length
    ? Math.round((browserChecks.filter((c) => c.status === "blocked").length / browserChecks.length) * 100)
    : 0;
  const failedRate = browserChecks.length
    ? Math.round((browserChecks.filter((c) => c.status !== "in_stock" && c.status !== "out_of_stock").length / browserChecks.length) * 100)
    : 0;
  const latencies = browserChecks.map((c) => c.latency_ms ?? 0).filter(Boolean).sort((a, b) => a - b);
  const medianMs = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Monitored products" value={products.length} accent="bg-indigo-50 text-indigo-600" icon={<Package className="h-5 w-5" />} />
        <StatCard label="In stock" value={inStock} accent="bg-emerald-50 text-emerald-600" icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Out of stock" value={outStock} accent="bg-red-50 text-red-600" icon={<XCircle className="h-5 w-5" />} />
        <StatCard label="Alerts (24h)" value={notifs.length} accent="bg-amber-50 text-amber-600" icon={<BellRing className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent status changes" subtitle="Latest stock transitions across your products" />
          {recentChanges.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="No activity yet" subtitle="Once checks start landing, status changes appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentChanges.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                  {p.image_url && <img src={p.image_url} alt="" className="h-10 w-10 rounded-lg border border-slate-200 object-cover" />}
                  <div className="min-w-0 flex-1">
                    <a href={p.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600">
                      {p.title ?? p.url}
                    </a>
                    <p className="text-xs text-slate-500">
                      {fmtPrice(p.last_price, p.currency)} · changed {formatDistanceToNow(new Date(p.last_status_change_at!), { addSuffix: true })}
                    </p>
                  </div>
                  <StatusBadge status={p.is_active ? p.stock_status : "paused"} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <WorkerCard />
          <Card>
            <CardHeader title="Check quality" subtitle="Browser checks · last hour" />
            <div className="space-y-4 px-5 py-4">
              {browserChecks.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No checks in the last hour. If the worker is Online, it's simply between
                  checks — a long interval or the error backoff.
                </p>
              ) : (
                <>
                  <HealthRow
                    label="Last check"
                    value={lastCheck ? formatDistanceToNow(new Date(lastCheck), { addSuffix: true }) : "never"}
                  />
                  <HealthRow label="Median speed" value={`${(medianMs / 1000).toFixed(1)}s`} />
                  {/* Lazada serving a captcha is the thing that would silently break us. */}
                  <HealthRow label="Captcha / blocked" value={`${blockedRate}%`} good={blockedRate === 0} />
                  <HealthRow label="Inconclusive" value={`${failedRate}%`} good={failedRate < 10} />
                  {/* Sample size for the four rows above — small n means read them loosely. */}
                  <HealthRow label="Checks in window" value={String(browserChecks.length)} />
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent alerts" subtitle="Last 24 hours" />
            {notifs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">No alerts in the last 24h</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifs.slice(0, 5).map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <p className="truncate text-sm text-slate-700">{n.message}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Fly's published price for the preset in fly.toml: shared-cpu-4x, whose 1GB base RAM is
// included = $7.78/mo. (An earlier per-second CPU+RAM formula here was badly wrong — it
// billed RAM ~10x over and reported ~$52/mo.) Keep this in step with fly.toml; Fly's own
// dashboard stays the billing source of truth — this is a sanity check, not an invoice.
const FLY_USD_PER_MONTH = 7.78;
const FLY_USD_PER_HOUR = FLY_USD_PER_MONTH / 730;

function fmtDuration(from: string): string {
  const secs = Math.max(0, (Date.now() - new Date(from).getTime()) / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function WorkerCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["worker"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lzd_worker_state").select("*").maybeSingle();
      if (error) throw error;
      return data as WorkerState | null;
    },
    refetchInterval: 15000,
  });

  const beat = data?.last_heartbeat_at ? new Date(data.last_heartbeat_at).getTime() : 0;
  const ageSecs = beat ? (Date.now() - beat) / 1000 : Infinity;
  const online = ageSecs <= WORKER_STALE_SECS;
  const neverRan = !beat;

  const hoursUp = data?.started_at ? (Date.now() - new Date(data.started_at).getTime()) / 3.6e6 : 0;
  const isFly = !!data?.region && data.region !== "local";

  return (
    <Card>
      <CardHeader
        title="Monitor worker"
        subtitle={
          neverRan ? "Never started"
            : isFly ? `Fly.io · ${data!.region} · ${data!.machine_id?.slice(0, 8)}`
            : "Running locally"
        }
        action={
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <span className={`text-xs font-medium ${online ? "text-emerald-600" : "text-red-600"}`}>
              {neverRan ? "Offline" : online ? "Online" : "Stale"}
            </span>
          </span>
        }
      />
      <div className="space-y-3 px-5 py-4">
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : neverRan ? (
          <p className="text-sm text-slate-500">
            Nothing is checking stock yet. Deploy the worker (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">fly deploy</code>)
            or run it locally, and this card will come alive.
          </p>
        ) : (
          <>
            <HealthRow
              label="Last heartbeat"
              value={ageSecs < 60 ? `${Math.round(ageSecs)}s ago` : formatDistanceToNow(new Date(beat), { addSuffix: true })}
              good={online}
            />
            {data?.started_at && <HealthRow label="Uptime" value={fmtDuration(data.started_at)} />}
            <HealthRow label="Checks completed" value={(data?.checks_completed ?? 0).toLocaleString()} />
            {(data?.checks_failed ?? 0) > 0 && (
              <HealthRow label="Checks failed" value={(data!.checks_failed).toLocaleString()} good={false} />
            )}
            {(data?.browser_restarts ?? 0) > 0 && (
              <HealthRow label="Browser restarts" value={String(data!.browser_restarts)} />
            )}
            {isFly && (
              <HealthRow
                label="Est. cost this run"
                value={`~$${(hoursUp * FLY_USD_PER_HOUR).toFixed(2)} · ~$${FLY_USD_PER_MONTH.toFixed(2)}/mo`}
              />
            )}
            {!online && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                No heartbeat for {Math.round(ageSecs)}s — the worker is probably down, so
                restocks are not being detected. Check <code>fly logs</code>.
              </p>
            )}
            {data?.last_error && (
              <p className="truncate rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700" title={data.last_error}>
                Last error: {data.last_error}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function HealthRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={`text-sm font-semibold ${good === undefined ? "text-slate-800" : good ? "text-emerald-600" : "text-amber-600"}`}>
        {value}
      </span>
    </div>
  );
}
