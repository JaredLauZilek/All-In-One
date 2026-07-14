// lzd-product-preview — called by the web app (JWT-verified) when adding a URL.
// Fetches the product page once and returns a preview for confirmation.

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchProductPage, parseProductPage, parseLazadaUrl } from "./lazada.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { url } = await req.json().catch(() => ({}));
  const ids = url ? parseLazadaUrl(url) : null;
  if (!ids) return json({ error: "Not a valid Lazada product URL" }, 400);

  const { data: secrets } = await admin.rpc("lzd_get_secrets");
  const { data: stateRow } = await admin.from("lzd_fetch_state").select("*").eq("id", 1).single();

  const fetched = await fetchProductPage(
    url,
    stateRow ?? { cookies: null, user_agent: null, blocked_until: null },
    secrets?.LZD_SCRAPER_API_KEY ?? null,
  );
  if (!fetched.html || fetched.error) {
    return json({ error: "Could not fetch the product page right now. Try again shortly.", detail: fetched.error }, 502);
  }

  const parsed = parseProductPage(fetched.html);
  return json({
    item_id: ids.itemId,
    sku_id: ids.skuId,
    title: parsed.title ?? null,
    image_url: parsed.image ?? null,
    price: parsed.price ?? null,
    currency: parsed.currency ?? "MYR",
    shop_name: parsed.shopName ?? null,
    stock_status: parsed.status,
    fetch_method: fetched.method,
    latency_ms: fetched.latencyMs,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
