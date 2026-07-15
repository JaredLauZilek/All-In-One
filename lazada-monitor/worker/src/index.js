// Lazada restock worker — the replacement for the pg_cron -> lzd-check-stock HTTP path.
//
// Runs a real Chromium (Playwright) because Lazada only reveals true stock to a
// hydrated browser (see src/lazada.js). Supabase Edge Functions run Deno and cannot
// launch a browser, which is why this lives on its own host.
//
// It owns exactly what the edge function used to: pick due products, check stock, log
// lzd_checks, update lzd_products, and fire a Telegram alert on out_of_stock->in_stock.
// Uses ZERO scraping-API credits.

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { checkStock, createContext, createPage } from "./lazada.js";
import { tgSendMessage, escapeHtml } from "./telegram.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TICK_MS = Number(process.env.TICK_MS ?? 5000);
const JITTER_MS = Number(process.env.JITTER_MS ?? 4000);
const ERROR_BACKOFF_AFTER = 5;
const ERROR_BACKOFF_SECS = 900;
const BROWSER_RECYCLE_CHECKS = 500; // guard against long-run memory creep
const MAX_WARM_PAGES = Number(process.env.MAX_WARM_PAGES ?? 6); // ~1GB VM headroom

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// --- health reporting -------------------------------------------------------
// The dashboard reads lzd_worker_state to show whether the monitor is alive. Fly
// injects FLY_MACHINE_ID / FLY_REGION; they're absent when running locally.
const STARTED_AT = new Date().toISOString();
const health = { checksCompleted: 0, checksFailed: 0, browserRestarts: 0, lastError: null };

async function heartbeat() {
  const { error } = await db
    .from("lzd_worker_state")
    .update({
      started_at: STARTED_AT,
      last_heartbeat_at: new Date().toISOString(),
      machine_id: process.env.FLY_MACHINE_ID ?? "local",
      region: process.env.FLY_REGION ?? "local",
      vm_memory_mb: Number(process.env.FLY_VM_MEMORY_MB ?? 0) || null,
      checks_completed: health.checksCompleted,
      checks_failed: health.checksFailed,
      browser_restarts: health.browserRestarts,
      last_error: health.lastError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) log("heartbeat failed:", error.message);
}

let botToken = null;
async function getBotToken() {
  if (botToken) return botToken;
  const { data, error } = await db.rpc("lzd_get_secrets");
  if (error) throw new Error(`lzd_get_secrets failed: ${error.message}`);
  botToken = data?.LZD_TELEGRAM_BOT_TOKEN ?? null;
  return botToken;
}

/**
 * Is `now` inside the product's daily checking window, in ITS timezone?
 * Windows may wrap midnight (22:00 -> 06:00), hence the two branches.
 * No window configured => always active.
 */
export function inActiveWindow(p, now = new Date()) {
  if (!p.active_from || !p.active_to) return true;
  const from = p.active_from.slice(0, 5);
  const to = p.active_to.slice(0, 5);
  if (from === to) return true; // degenerate: treat as full day
  const cur = new Intl.DateTimeFormat("en-GB", {
    timeZone: p.timezone || "Asia/Kuala_Lumpur",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return from < to
    ? cur >= from && cur < to // same-day window
    : cur >= from || cur < to; // wraps midnight
}

function isDue(p, now) {
  if (!inActiveWindow(p, new Date(now))) return false;
  if (!p.last_checked_at) return true;
  const bursting = p.burst_until && new Date(p.burst_until).getTime() > now;
  let interval = bursting ? p.burst_interval_secs : p.check_interval_secs;
  if (p.consecutive_errors >= ERROR_BACKOFF_AFTER) interval = Math.max(interval, ERROR_BACKOFF_SECS);
  return new Date(p.last_checked_at).getTime() + interval * 1000 <= now;
}

/** Last status that was actually determined (ignores unknown/blocked/error noise). */
async function lastRealStatus(productId, fallback) {
  if (fallback === "in_stock" || fallback === "out_of_stock") return fallback;
  const { data } = await db
    .from("lzd_checks")
    .select("status")
    .eq("product_id", productId)
    .in("status", ["in_stock", "out_of_stock"])
    .order("checked_at", { ascending: false })
    .range(1, 1); // skip the row just inserted
  return data?.[0]?.status ?? "unknown";
}

async function notifyRestock(p, parsed) {
  const { data: settings } = await db
    .from("lzd_settings")
    .select("telegram_chat_id")
    .eq("user_id", p.user_id)
    .maybeSingle();
  if (!settings?.telegram_chat_id) return;

  const cur = parsed.currency ?? p.currency ?? "MYR";
  const priceTxt =
    parsed.price !== undefined
      ? `\n💰 ${cur} ${parsed.price.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
      : "";
  const msg = `🟢 <b>RESTOCKED!</b>\n\n<b>${escapeHtml(parsed.title ?? p.title ?? "Product")}</b>${priceTxt}\n\n⚡ Grab it before it's gone!`;

  const token = await getBotToken();
  const sent = await tgSendMessage(token, settings.telegram_chat_id, msg, {
    text: "🛒 Open in Lazada",
    url: p.url,
  });
  await db.from("lzd_notifications").insert({
    user_id: p.user_id,
    product_id: p.id,
    type: "restock",
    message: `Restocked: ${parsed.title ?? p.title ?? p.url}`,
    telegram_message_id: sent.messageId ?? null,
    status: sent.ok ? "sent" : "failed",
    error: sent.error ?? null,
  });
  log(sent.ok ? `ALERT sent: ${p.title}` : `ALERT FAILED: ${sent.error}`);
}

async function processProduct(page, p) {
  const parsed = await checkStock(page, p.url);
  const real = parsed.status === "in_stock" || parsed.status === "out_of_stock";

  await db.from("lzd_checks").insert({
    product_id: p.id,
    status: parsed.status,
    price: parsed.price ?? null,
    fetch_method: "browser",
    http_status: parsed.status === "error" ? 0 : 200,
    latency_ms: parsed.latencyMs,
    error: parsed.error ?? null,
  });

  const update = {
    stock_status: parsed.status,
    last_checked_at: new Date().toISOString(),
    consecutive_errors: real ? 0 : p.consecutive_errors + 1,
  };
  if (p.stock_status !== parsed.status) update.last_status_change_at = new Date().toISOString();
  if (parsed.price !== undefined) update.last_price = parsed.price;
  if (parsed.currency) update.currency = parsed.currency;
  if (parsed.title) update.title = parsed.title;
  if (parsed.image) update.image_url = parsed.image;
  await db.from("lzd_products").update(update).eq("id", p.id);

  if (parsed.status === "in_stock" && p.notify_on_restock) {
    const prev = await lastRealStatus(p.id, p.stock_status);
    if (prev === "out_of_stock") await notifyRestock(p, parsed);
  }

  if (real) health.checksCompleted++;
  else {
    health.checksFailed++;
    health.lastError = parsed.error ?? `status=${parsed.status}`;
  }

  log(`${parsed.status.padEnd(12)} ${parsed.latencyMs}ms  ${(p.title ?? p.url).slice(0, 60)}`);
}

async function main() {
  log("worker starting…");
  let browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let ctx = await createContext(browser);
  let sinceRecycle = 0;

  // One warm page per product, kept open across checks. This is what keeps us off
  // Lazada's throttle — see the comment on checkStock().
  const warm = new Map(); // productId -> page

  async function pageFor(p) {
    const existing = warm.get(p.id);
    if (existing && !existing.isClosed()) return existing;
    if (warm.size >= MAX_WARM_PAGES) {
      const [oldId, oldPage] = warm.entries().next().value;
      await oldPage.close().catch(() => {});
      warm.delete(oldId);
    }
    const page = await createPage(ctx);
    warm.set(p.id, page);
    return page;
  }

  async function recycle() {
    log("recycling browser");
    for (const pg of warm.values()) await pg.close().catch(() => {});
    warm.clear();
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    ctx = await createContext(browser);
    sinceRecycle = 0;
    health.browserRestarts++;
  }

  const shutdown = async () => {
    log("shutting down");
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await heartbeat();

  for (;;) {
    try {
      const { data: products, error } = await db.from("lzd_products").select("*").eq("is_active", true);
      if (error) throw error;

      const now = Date.now();
      const due = (products ?? [])
        .filter((p) => isDue(p, now))
        .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? ""));

      // Drop warm pages for products that are gone or paused.
      for (const [id, pg] of warm) {
        if (!(products ?? []).some((p) => p.id === id && p.is_active)) {
          await pg.close().catch(() => {});
          warm.delete(id);
        }
      }

      for (const p of due) {
        await processProduct(await pageFor(p), p);
        if (++sinceRecycle >= BROWSER_RECYCLE_CHECKS) await recycle();
        // Small jitter so requests aren't perfectly metronomic.
        await sleep(Math.random() * JITTER_MS);
      }
    } catch (e) {
      health.lastError = String(e).slice(0, 200);
      log("loop error:", health.lastError);
      await sleep(10000);
    }
    // Heartbeat every pass, so a stale timestamp in the dashboard means the worker
    // is genuinely wedged or dead — not merely idle between checks.
    await heartbeat();
    await sleep(TICK_MS);
  }
}

main();
