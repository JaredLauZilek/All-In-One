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

export const BOT_USERNAME = "pokemonAIO_bot";

export function fmtPrice(price: number | null | undefined, currency = "MYR"): string {
  if (price === null || price === undefined) return "—";
  return `${currency === "MYR" ? "RM" : currency + " "}${Number(price).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
