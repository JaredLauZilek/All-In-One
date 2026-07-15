import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Plus, Package, Zap, Trash2, History, ExternalLink, Clock, Moon } from "lucide-react";
import { supabase, fmtPrice, parseLazadaUrl, inActiveWindow, type Product, type Check } from "../lib/supabase";
import { Button, Card, Input, Modal, StatusBadge, Switch, Spinner, EmptyState, cn } from "../components/ui";

// "direct"/"scrape_api" only appear on historical rows from the retired HTTP checker.
const FETCH_METHOD_LABEL: Record<string, string> = {
  browser: "Browser",
  direct: "Direct (legacy)",
  scrape_api: "ScraperAPI (legacy)",
};

// Checks cost nothing per request, but going too fast BACKFIRES. Measured 2026-07 from
// Fly/sin: at a 10s interval Lazada silently throttles us — latency decayed 6s -> 21s ->
// 45s (timeout) -> 89s within ~2 minutes, so the achieved cadence became ~80s, far worse
// than simply asking for 60s. Backing off let it recover. 60s is the tested sweet spot;
// treat sub-30s as experimental and watch "Captcha / blocked" + median speed on the
// dashboard. This is a minimum gap between checks, never a guarantee.
const INTERVALS = [
  { secs: 15, label: "15 sec (may throttle)" },
  { secs: 30, label: "30 sec (may throttle)" },
  { secs: 60, label: "1 min (recommended)" },
  { secs: 180, label: "3 min" },
  { secs: 300, label: "5 min" },
  { secs: 900, label: "15 min" },
  { secs: 3600, label: "1 hour" },
];

export default function Products() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [scheduling, setScheduling] = useState<Product | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lzd_products").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Product> }) => {
      const { error } = await supabase.from("lzd_products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lzd_products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {products?.length ?? 0} product{(products?.length ?? 0) === 1 ? "" : "s"} monitored
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add product
        </Button>
      </div>

      {!products?.length ? (
        <Card>
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No products yet"
            subtitle="Paste a Lazada product URL to start monitoring it for restocks."
            action={<Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add your first product</Button>}
          />
        </Card>
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 font-medium">Interval</th>
                <th className="px-3 py-3 font-medium">Schedule</th>
                <th className="px-3 py-3 font-medium">Last check</th>
                <th className="px-3 py-3 font-medium">Active</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => {
                const bursting = p.burst_until && new Date(p.burst_until) > new Date();
                const scheduled = !!(p.active_from && p.active_to);
                const sleeping = p.is_active && scheduled && !inActiveWindow(p);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        {p.image_url
                          ? <img src={p.image_url} alt="" className="h-11 w-11 rounded-lg border border-slate-200 object-cover" />
                          : <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100"><Package className="h-5 w-5 text-slate-400" /></div>}
                        <div className="min-w-0 max-w-md">
                          <a href={p.url} target="_blank" rel="noreferrer" className="group flex items-center gap-1 truncate font-medium text-slate-800 hover:text-indigo-600">
                            <span className="truncate">{p.title ?? p.url}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                          </a>
                          <p className="truncate text-xs text-slate-400">{p.shop_name ?? `item ${p.item_id}`}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={p.is_active ? p.stock_status : "paused"} />
                        {sleeping && (
                          <span
                            title={`Outside its checking window (${p.active_from!.slice(0, 5)}–${p.active_to!.slice(0, 5)} ${p.timezone}) — not being checked right now`}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-400/20"
                          >
                            <Moon className="h-3 w-3" /> Asleep
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 font-medium text-slate-700">{fmtPrice(p.last_price, p.currency)}</td>
                    <td className="px-3 py-3.5">
                      <select
                        value={p.check_interval_secs}
                        onChange={(e) => update.mutate({ id: p.id, patch: { check_interval_secs: Number(e.target.value) } })}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {INTERVALS.map((i) => <option key={i.secs} value={i.secs}>{i.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3.5">
                      <button
                        onClick={() => setScheduling(p)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Clock className="h-3 w-3" />
                        {scheduled ? `${p.active_from!.slice(0, 5)}–${p.active_to!.slice(0, 5)}` : "24/7"}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-500">
                      {p.last_checked_at ? formatDistanceToNow(new Date(p.last_checked_at), { addSuffix: true }) : "pending…"}
                    </td>
                    <td className="px-3 py-3.5">
                      <Switch checked={p.is_active} onChange={(v) => update.mutate({ id: p.id, patch: { is_active: v } })} />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title={bursting ? "Burst mode active (30s checks)" : "Burst: check every 30s for 30 min"}
                          onClick={() =>
                            update.mutate({
                              id: p.id,
                              patch: { burst_until: bursting ? null : new Date(Date.now() + 30 * 60 * 1000).toISOString() },
                            })
                          }
                          className={cn(
                            "rounded-md p-1.5 transition-colors",
                            bursting ? "bg-amber-100 text-amber-600" : "text-slate-400 hover:bg-slate-100 hover:text-amber-500",
                          )}
                        >
                          <Zap className="h-4 w-4" />
                        </button>
                        <button title="Check history" onClick={() => setDetail(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600">
                          <History className="h-4 w-4" />
                        </button>
                        <button
                          title="Delete"
                          onClick={() => { if (confirm(`Stop monitoring "${p.title ?? p.url}"?`)) remove.mutate(p.id); }}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <AddProductModal open={addOpen} onClose={() => setAddOpen(false)} />
      {detail && <HistoryModal product={detail} onClose={() => setDetail(null)} />}
      {scheduling && <ScheduleModal product={scheduling} onClose={() => setScheduling(null)} />}
    </div>
  );
}

function AddProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setUrl(""); setError(null); setSaving(false);
  }

  async function save() {
    const ids = parseLazadaUrl(url);
    if (!ids) {
      setError("That doesn't look like a Lazada product URL (it should contain …-i<digits>.html).");
      return;
    }
    setSaving(true);
    const { data: settings } = await supabase.from("lzd_settings").select("default_check_interval_secs").maybeSingle();
    // Title/image/price/stock are left blank on purpose: the browser worker picks this
    // product up on its next pass (it's immediately due) and fills them in, which the
    // table then shows live via Realtime.
    const { error } = await supabase.from("lzd_products").insert({
      check_interval_secs: settings?.default_check_interval_secs ?? 180,
      url: url.trim(),
      item_id: ids.itemId,
      sku_id: ids.skuId,
      stock_status: "unknown",
    });
    setSaving(false);
    if (error) {
      setError(error.code === "23505" ? "You're already monitoring that product." : error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["products"] });
    reset(); onClose();
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Add Lazada product">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Product URL</label>
          <Input
            placeholder="https://www.lazada.com.my/products/…"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
          <p className="mt-2 text-xs text-slate-500">
            Works with any Lazada site (.com.my, .sg, …). The monitor fills in the name, photo
            and price on its first check — usually within a few seconds.
          </p>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <Button onClick={save} loading={saving} disabled={!url.trim()} className="w-full">
          Start monitoring
        </Button>
      </div>
    </Modal>
  );
}

const TIMEZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Bangkok", "Asia/Jakarta", "Asia/Manila", "UTC"];

function ScheduleModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const [always, setAlways] = useState(!(product.active_from && product.active_to));
  const [from, setFrom] = useState(product.active_from?.slice(0, 5) ?? "08:00");
  const [to, setTo] = useState(product.active_to?.slice(0, 5) ?? "00:00");
  const [tz, setTz] = useState(product.timezone || "Asia/Kuala_Lumpur");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("lzd_products")
      .update({
        active_from: always ? null : `${from}:00`,
        active_to: always ? null : `${to}:00`,
        timezone: tz,
      })
      .eq("id", product.id);
    setSaving(false);
    if (!error) {
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    }
  }

  const wraps = !always && from > to;

  return (
    <Modal open onClose={onClose} title="Checking schedule">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Skip checks when a drop can't happen — fewer requests means less chance Lazada
          throttles you.
        </p>

        <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
          <Switch checked={always} onChange={setAlways} />
          <div>
            <p className="text-sm font-medium text-slate-700">Check around the clock</p>
            <p className="text-xs text-slate-500">Never sleep</p>
          </div>
        </label>

        {!always && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600">Check from</label>
                <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600">until</label>
                <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Timezone</label>
              <select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {TIMEZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
              </select>
            </div>
            <p className="text-xs text-slate-500">
              {wraps
                ? `Checks overnight: ${from} through midnight to ${to} the next day.`
                : `Checks between ${from} and ${to} daily; asleep the rest of the day.`}
            </p>
          </div>
        )}

        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Note: this stops <b>checks</b>, not the Fly machine — it won't reduce your ~$5/mo
          compute bill, since Fly charges for the machine being up.
        </p>

        <Button onClick={save} loading={saving} className="w-full">Save schedule</Button>
      </div>
    </Modal>
  );
}

function HistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data: checks, isLoading } = useQuery({
    queryKey: ["checks", product.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lzd_checks").select("*").eq("product_id", product.id)
        .order("checked_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data as Check[];
    },
  });

  return (
    <Modal open onClose={onClose} title={product.title ?? "Check history"} wide>
      {isLoading ? <Spinner /> : !checks?.length ? (
        <p className="py-8 text-center text-sm text-slate-400">No checks recorded yet — the next tick is at most 30s away.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">Time</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Price</th>
              <th className="py-2 pr-3 font-medium">Method</th>
              <th className="py-2 font-medium">Latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {checks.map((c) => (
              <tr key={c.id}>
                <td className="py-2.5 pr-3 text-xs text-slate-600">{format(new Date(c.checked_at), "d MMM HH:mm:ss")}</td>
                <td className="py-2.5 pr-3"><StatusBadge status={c.status} /></td>
                <td className="py-2.5 pr-3 text-slate-700">{fmtPrice(c.price, product.currency)}</td>
                <td className="py-2.5 pr-3 text-xs text-slate-500">{FETCH_METHOD_LABEL[c.fetch_method ?? ""] ?? c.fetch_method ?? "—"}</td>
                <td className="py-2.5 text-xs text-slate-500">{c.latency_ms != null ? `${c.latency_ms} ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
