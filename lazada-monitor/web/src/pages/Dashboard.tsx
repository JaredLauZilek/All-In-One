import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Package, CheckCircle2, XCircle, BellRing, Activity, Gauge } from "lucide-react";
import { supabase, fmtPrice, type Product, type Notification } from "../lib/supabase";
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
  const lastCheck = checks[0]?.checked_at;
  const blockedRate = checks.length ? Math.round((checks.filter((c) => c.status === "blocked").length / checks.length) * 100) : 0;
  const directRate = checks.length ? Math.round((checks.filter((c) => c.fetch_method === "direct").length / checks.length) * 100) : 100;
  const recentChanges = products.filter((p) => p.last_status_change_at).slice(0, 8);

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
          <ScraperUsageCard />
          <Card>
            <CardHeader title="Checker health" subtitle="Last 50 checks" />
            <div className="space-y-4 px-5 py-4">
              <HealthRow label="Last check" value={lastCheck ? formatDistanceToNow(new Date(lastCheck), { addSuffix: true }) : "never"} />
              <HealthRow label="Direct fetch rate" value={`${directRate}%`} good={directRate > 70} />
              <HealthRow label="Blocked rate" value={`${blockedRate}%`} good={blockedRate < 10} />
              <HealthRow label="Checks logged" value={String(checks.length)} />
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

interface ScraperUsage {
  request_count: number;
  request_limit: number;
  credits_left: number;
  failed_request_count: number;
  next_billing_date: string | null;
  error?: string;
}

function ScraperUsageCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["scraper-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("lzd-scraper-usage");
      if (error) throw error;
      return data as ScraperUsage;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const pct = data && data.request_limit > 0 ? Math.min(100, (data.request_count / data.request_limit) * 100) : 0;
  const state = pct >= 90 ? "critical" : pct >= 75 ? "warning" : "ok";
  const barColor = state === "critical" ? "bg-red-500" : state === "warning" ? "bg-amber-500" : "bg-indigo-500";

  return (
    <Card>
      <CardHeader
        title="ScraperAPI credits"
        subtitle="Consumed when direct fetch is blocked"
        action={<Gauge className="h-4 w-4 text-slate-400" />}
      />
      <div className="space-y-3 px-5 py-4">
        {isLoading || !data || data.error ? (
          <p className="text-sm text-slate-400">{data?.error ? "Usage unavailable right now" : "Loading…"}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-semibold text-slate-900">
                {data.request_count.toLocaleString()}
                <span className="text-sm font-normal text-slate-500"> / {data.request_limit.toLocaleString()}</span>
              </p>
              <span className={`text-xs font-medium ${state === "critical" ? "text-red-600" : state === "warning" ? "text-amber-600" : "text-slate-500"}`}>
                {state === "critical" ? "Almost out" : state === "warning" ? "Running low" : `${Math.round(pct)}% used`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <HealthRow label="Credits left" value={data.credits_left.toLocaleString()} good={state === "ok"} />
            <HealthRow label="Failed requests" value={data.failed_request_count.toLocaleString()} />
            {data.next_billing_date && (
              <HealthRow label="Resets on" value={format(new Date(data.next_billing_date), "d MMM yyyy")} />
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
