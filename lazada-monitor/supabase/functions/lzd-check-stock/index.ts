// lzd-check-stock — invoked by pg_cron every 30s (x-lzd-cron-secret header).
// Checks due products via tiered fetch (direct -> ScraperAPI), records history,
// and fires a Telegram alert on out_of_stock -> in_stock transitions.

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchProductPage, parseProductPage, type FetchState, type StockStatus } from "./lazada.ts";
import { tgSendMessage, escapeHtml } from "./telegram.ts";

const MAX_PER_TICK = 10;
const DIRECT_BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
const ERROR_BACKOFF_AFTER = 5;
const ERROR_BACKOFF_SECS = 900;

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: secrets, error: secErr } = await admin.rpc("lzd_get_secrets");
  if (secErr) return json({ error: "secrets_unavailable" }, 500);

  if (req.headers.get("x-lzd-cron-secret") !== secrets.LZD_CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const now = Date.now();

  const [{ data: products }, { data: stateRow }, { data: settingsRows }] = await Promise.all([
    admin.from("lzd_products").select("*").eq("is_active", true),
    admin.from("lzd_fetch_state").select("*").eq("id", 1).single(),
    admin.from("lzd_settings").select("*"),
  ]);

  const state: FetchState = stateRow ?? { cookies: null, user_agent: null, blocked_until: null };
  const settingsByUser = new Map((settingsRows ?? []).map((s) => [s.user_id, s]));

  const due = (products ?? [])
    .filter((p) => {
      if (!p.last_checked_at) return true;
      const bursting = p.burst_until && new Date(p.burst_until).getTime() > now;
      let interval = bursting ? p.burst_interval_secs : p.check_interval_secs;
      if (p.consecutive_errors >= ERROR_BACKOFF_AFTER) interval = Math.max(interval, ERROR_BACKOFF_SECS);
      return new Date(p.last_checked_at).getTime() + interval * 1000 <= now;
    })
    .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? ""))
    .slice(0, MAX_PER_TICK);

  let directBlocked = 0, directOk = 0, scraperUsed = 0, notified = 0;

  const results = await Promise.allSettled(due.map(async (p) => {
    const fetched = await fetchProductPage(p.url, state, secrets.LZD_SCRAPER_API_KEY ?? null);
    if (fetched.usedFallback || (fetched.method === "direct" && fetched.error)) directBlocked++;
    else if (fetched.method === "direct") directOk++;
    if (fetched.method === "scrape_api") scraperUsed++;

    let status: StockStatus = "error";
    let parsed: ReturnType<typeof parseProductPage> | null = null;
    if (fetched.html && !fetched.error) {
      parsed = parseProductPage(fetched.html);
      status = parsed.status;
    } else if (fetched.error === "blocked_or_bad_response") {
      status = "blocked";
    }

    const isRealStatus = status === "in_stock" || status === "out_of_stock";
    const statusChanged = p.stock_status !== status;

    await admin.from("lzd_checks").insert({
      product_id: p.id,
      status,
      price: parsed?.price ?? null,
      fetch_method: fetched.method,
      http_status: fetched.httpStatus,
      latency_ms: fetched.latencyMs,
      error: fetched.error ?? null,
    });

    const update: Record<string, unknown> = {
      stock_status: status,
      last_checked_at: new Date().toISOString(),
      consecutive_errors: isRealStatus ? 0 : p.consecutive_errors + 1,
    };
    if (statusChanged) update.last_status_change_at = new Date().toISOString();
    if (parsed?.price !== undefined) update.last_price = parsed.price;
    if (parsed?.currency) update.currency = parsed.currency;
    if (parsed?.title) update.title = parsed.title;
    if (parsed?.image) update.image_url = parsed.image;
    if (parsed?.shopName) update.shop_name = parsed.shopName;
    await admin.from("lzd_products").update(update).eq("id", p.id);

    // Restock detection: new status in_stock, and the last *real* status was out_of_stock.
    if (status === "in_stock" && p.notify_on_restock) {
      let prevReal = p.stock_status;
      if (prevReal !== "in_stock" && prevReal !== "out_of_stock") {
        const { data: lastReal } = await admin
          .from("lzd_checks")
          .select("status")
          .eq("product_id", p.id)
          .in("status", ["in_stock", "out_of_stock"])
          .order("checked_at", { ascending: false })
          .range(1, 1); // skip the row we just inserted
        prevReal = lastReal?.[0]?.status ?? "unknown";
      }
      if (prevReal === "out_of_stock") {
        const settings = settingsByUser.get(p.user_id);
        if (settings?.telegram_chat_id) {
          const priceTxt = parsed?.price !== undefined
            ? `\n💰 ${parsed.currency ?? p.currency ?? "MYR"} ${parsed.price.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
            : "";
          const msg = `🟢 <b>RESTOCKED!</b>\n\n<b>${escapeHtml(parsed?.title ?? p.title ?? "Product")}</b>${priceTxt}\n\n⚡ Grab it before it's gone!`;
          const sent = await tgSendMessage(secrets.LZD_TELEGRAM_BOT_TOKEN, settings.telegram_chat_id, msg, {
            text: "🛒 Open in Lazada",
            url: p.url,
          });
          notified++;
          await admin.from("lzd_notifications").insert({
            user_id: p.user_id,
            product_id: p.id,
            type: "restock",
            message: `Restocked: ${parsed?.title ?? p.title ?? p.url}`,
            telegram_message_id: sent.messageId ?? null,
            status: sent.ok ? "sent" : "failed",
            error: sent.error ?? null,
          });
        }
      }
    }
    return status;
  }));

  // aggregate fetch-state bookkeeping
  const stateUpdate: Record<string, unknown> = {
    direct_ok_count: (stateRow?.direct_ok_count ?? 0) + directOk,
    direct_blocked_count: (stateRow?.direct_blocked_count ?? 0) + directBlocked,
    scraper_api_count: (stateRow?.scraper_api_count ?? 0) + scraperUsed,
  };
  if (directBlocked > 0 && directOk === 0) {
    stateUpdate.blocked_until = new Date(now + DIRECT_BLOCK_COOLDOWN_MS).toISOString();
  } else if (directOk > 0) {
    stateUpdate.blocked_until = null;
  }
  await admin.from("lzd_fetch_state").update(stateUpdate).eq("id", 1);

  return json({
    checked: due.length,
    notified,
    statuses: results.map((r) => (r.status === "fulfilled" ? r.value : `err:${r.reason}`)),
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
