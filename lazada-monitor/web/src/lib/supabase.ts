import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
);

export interface Product {
  id: string;
  user_id: string;
  url: string;
  item_id: string;
  sku_id: string | null;
  title: string | null;
  image_url: string | null;
  shop_name: string | null;
  currency: string;
  last_price: number | null;
  stock_status: "in_stock" | "out_of_stock" | "unknown" | "blocked" | "error";
  check_interval_secs: number;
  burst_interval_secs: number;
  burst_until: string | null;
  is_active: boolean;
  notify_on_restock: boolean;
  consecutive_errors: number;
  last_checked_at: string | null;
  last_status_change_at: string | null;
  created_at: string;
  /** Daily checking window in `timezone`; null start+end = always. May wrap midnight. */
  active_from: string | null;
  active_to: string | null;
  timezone: string;
}

/** Mirrors the worker's window logic so the UI can show when a product is idle. */
export function inActiveWindow(p: Pick<Product, "active_from" | "active_to" | "timezone">, now = new Date()): boolean {
  if (!p.active_from || !p.active_to) return true;
  const from = p.active_from.slice(0, 5);
  const to = p.active_to.slice(0, 5);
  if (from === to) return true;
  const cur = new Intl.DateTimeFormat("en-GB", {
    timeZone: p.timezone || "Asia/Kuala_Lumpur",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

export interface Check {
  id: number;
  product_id: string;
  checked_at: string;
  status: string;
  price: number | null;
  fetch_method: string | null;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface Notification {
  id: number;
  product_id: string | null;
  type: "restock" | "error" | "test";
  message: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
  product?: { title: string | null; url: string } | null;
}

export interface Settings {
  user_id: string;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  link_code: string;
  default_check_interval_secs: number;
  retention_days: number;
}

export interface WorkerState {
  started_at: string | null;
  last_heartbeat_at: string | null;
  machine_id: string | null;
  region: string | null;
  vm_memory_mb: number | null;
  checks_completed: number;
  checks_failed: number;
  browser_restarts: number;
  last_error: string | null;
}

/** Heartbeats older than this mean the worker is wedged or dead, not just idle. */
export const WORKER_STALE_SECS = 90;

export interface CaptureRequest {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  mimeType: string;
  isJson: boolean;
  stockish: boolean;
  bodyPreview: string | null;
}

export interface Capture {
  id: number;
  product_id: string | null;
  url: string;
  status: "pending" | "running" | "done" | "error";
  requests: CaptureRequest[] | null;
  summary: { total: number; jsonCount: number; stockSources: string[]; blocked: boolean; finalUrl: string } | null;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
}

export const BOT_USERNAME = "pokemonAIO_bot";

/**
 * Validates a Lazada product URL and pulls out its ids, client-side.
 * Metadata (title/image/price) and stock are filled in by the browser worker on its
 * first check, usually within seconds — no server round-trip needed to add a product.
 */
export function parseLazadaUrl(url: string): { itemId: string; skuId: string | null } | null {
  try {
    const u = new URL(url.trim());
    if (!/(^|\.)lazada\./.test(u.hostname)) return null;
    const m = u.pathname.match(/-i(\d+)(?:-s(\d+))?\.html/);
    if (!m) return null;
    return { itemId: m[1], skuId: m[2] ?? u.searchParams.get("skuId") };
  } catch {
    return null;
  }
}

export function fmtPrice(price: number | null | undefined, currency = "MYR"): string {
  if (price === null || price === undefined) return "—";
  return `${currency === "MYR" ? "RM" : currency + " "}${Number(price).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
