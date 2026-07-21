import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Radar, ChevronRight, ChevronDown, Loader2, AlertTriangle, Target } from "lucide-react";
import { supabase, type Capture, type CaptureRequest, type Product } from "../lib/supabase";
import { Card, CardHeader, Button, cn } from "./ui";

/**
 * Self-service network inspector: asks the worker to load a product page in Playwright and
 * record every XHR/fetch, so you can see exactly where the page gets its stock data. The
 * worker does the capture (browser lives on Fly); this just queues a job and renders it.
 */
export default function NetworkInspector({ product }: { product: Product }) {
  const qc = useQueryClient();

  const { data: capture } = useQuery({
    queryKey: ["capture", product.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("lzd_captures")
        .select("*")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as Capture) ?? null;
    },
    // Poll while a job is in flight so status/result update even without realtime.
    refetchInterval: (q) => {
      const s = (q.state.data as Capture | null)?.status;
      return s === "pending" || s === "running" ? 2000 : false;
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lzd_captures").insert({ product_id: product.id, url: product.url });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capture", product.id] }),
  });

  const busy = capture?.status === "pending" || capture?.status === "running";

  return (
    <Card>
      <CardHeader
        title="Network inspector"
        subtitle="Every XHR/fetch the product page makes — find the stock source"
        action={
          <Button onClick={() => run.mutate()} loading={run.isPending || busy} disabled={busy}>
            <Radar className="h-4 w-4" />
            {busy ? "Capturing…" : "Run capture"}
          </Button>
        }
      />
      <div className="px-5 py-4">
        {!capture ? (
          <p className="text-sm text-slate-500">
            No capture yet. Hit <b>Run capture</b> — the worker loads this product's page in a
            real browser and logs every request it makes. Takes ~20–30s.
          </p>
        ) : capture.status === "pending" || capture.status === "running" ? (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
            {capture.status === "pending" ? "Queued — waiting for the worker…" : "Loading the page & recording requests…"}
          </div>
        ) : capture.status === "error" ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Capture failed: {capture.error}</span>
          </div>
        ) : (
          <CaptureResult capture={capture} />
        )}
      </div>
    </Card>
  );
}

function CaptureResult({ capture }: { capture: Capture }) {
  const [filter, setFilter] = useState<"all" | "json" | "stock">("stock");
  const reqs = capture.requests ?? [];
  const shown = reqs.filter((r) => (filter === "all" ? true : filter === "json" ? r.isJson : r.stockish));
  const s = capture.summary;

  return (
    <div className="space-y-4">
      {/* Verdict */}
      {s?.blocked ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The page was redirected to Lazada's anti-bot challenge — no product data captured this run. Try again (a fresh load usually gets through).</span>
        </div>
      ) : s?.stockSources?.length ? (
        <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <div className="flex items-center gap-1.5 font-medium">
            <Target className="h-4 w-4" /> Stock data source{s.stockSources.length > 1 ? "s" : ""} found
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {s.stockSources.map((u) => (
              <li key={u} className="truncate font-mono text-xs text-emerald-800" title={u}>{shortUrl(u)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          No obvious inventory endpoint in the XHR/fetch calls — the stock state is likely applied purely by client-side JS after load.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {formatDistanceToNow(new Date(capture.completed_at ?? capture.created_at), { addSuffix: true })} ·{" "}
          {s?.total ?? reqs.length} XHR/fetch · {s?.jsonCount ?? 0} JSON
        </span>
        <div className="flex gap-1">
          {(["stock", "json", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium capitalize",
                filter === f ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100",
              )}
            >
              {f === "stock" ? "Stock-related" : f}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-slate-400">No requests match this filter.</p>
        ) : (
          shown.map((r, i) => <RequestRow key={i} req={r} />)
        )}
      </div>
    </div>
  );
}

function RequestRow({ req }: { req: CaptureRequest }) {
  const [open, setOpen] = useState(false);
  const canExpand = !!req.bodyPreview;
  return (
    <div className={cn(req.stockish && "bg-emerald-50/40")}>
      <button
        onClick={() => canExpand && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left", canExpand && "hover:bg-slate-50")}
      >
        {canExpand ? (
          open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", req.status < 300 ? "bg-slate-100 text-slate-600" : "bg-red-100 text-red-600")}>
          {req.method} {req.status}
        </span>
        {req.stockish && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">stock?</span>}
        {req.isJson && <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">JSON</span>}
        <span className="truncate font-mono text-xs text-slate-700" title={req.url}>{shortUrl(req.url)}</span>
      </button>
      {open && req.bodyPreview && (
        <pre className="mx-3 mb-3 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {pretty(req.bodyPreview)}
        </pre>
      )}
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return x.host + x.pathname + (x.search ? x.search.slice(0, 40) + (x.search.length > 40 ? "…" : "") : "");
  } catch {
    return u;
  }
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
