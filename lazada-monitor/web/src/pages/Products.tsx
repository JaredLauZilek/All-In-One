import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Plus, Package, Zap, Trash2, History, ExternalLink } from "lucide-react";
import { supabase, fmtPrice, type Product, type Check } from "../lib/supabase";
import { Button, Card, Input, Modal, StatusBadge, Switch, Spinner, EmptyState, cn } from "../components/ui";

const INTERVALS = [
  { secs: 60, label: "1 min" },
  { secs: 180, label: "3 min" },
  { secs: 300, label: "5 min" },
  { secs: 900, label: "15 min" },
  { secs: 3600, label: "1 hour" },
];

interface Preview {
  item_id: string;
  sku_id: string | null;
  title: string | null;
  image_url: string | null;
  price: number | null;
  currency: string;
  shop_name: string | null;
  stock_status: string;
}

export default function Products() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);

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
                <th className="px-3 py-3 font-medium">Last check</th>
                <th className="px-3 py-3 font-medium">Active</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => {
                const bursting = p.burst_until && new Date(p.burst_until) > new Date();
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
                    <td className="px-3 py-3.5"><StatusBadge status={p.is_active ? p.stock_status : "paused"} /></td>
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
    </div>
  );
}

function AddProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setUrl(""); setPreview(null); setError(null); setLoading(false); setSaving(false);
  }

  async function fetchPreview() {
    setLoading(true); setError(null); setPreview(null);
    const { data, error } = await supabase.functions.invoke("lzd-product-preview", { body: { url: url.trim() } });
    setLoading(false);
    if (error || data?.error) { setError(data?.error ?? "Could not fetch that URL. Check it and try again."); return; }
    setPreview(data as Preview);
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    const { data: settings } = await supabase.from("lzd_settings").select("default_check_interval_secs").maybeSingle();
    const { error } = await supabase.from("lzd_products").insert({
      check_interval_secs: settings?.default_check_interval_secs ?? 180,
      url: url.trim(),
      item_id: preview.item_id,
      sku_id: preview.sku_id,
      title: preview.title,
      image_url: preview.image_url,
      shop_name: preview.shop_name,
      currency: preview.currency,
      last_price: preview.price,
      stock_status: preview.stock_status,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    qc.invalidateQueries({ queryKey: ["products"] });
    reset(); onClose();
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Add Lazada product">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Product URL</label>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.lazada.com.my/products/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
            />
            <Button variant="secondary" onClick={fetchPreview} loading={loading} disabled={!url.trim()}>Preview</Button>
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        {preview && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex gap-4">
              {preview.image_url && <img src={preview.image_url} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{preview.title ?? "Unknown title"}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{fmtPrice(preview.price, preview.currency)}</p>
                <div className="mt-2"><StatusBadge status={preview.stock_status} /></div>
              </div>
            </div>
            <Button onClick={save} loading={saving} className="mt-4 w-full">Start monitoring</Button>
          </div>
        )}
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
                <td className="py-2.5 pr-3 text-xs text-slate-500">{c.fetch_method === "scrape_api" ? "ScraperAPI" : "Direct"}</td>
                <td className="py-2.5 text-xs text-slate-500">{c.latency_ms != null ? `${c.latency_ms} ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
