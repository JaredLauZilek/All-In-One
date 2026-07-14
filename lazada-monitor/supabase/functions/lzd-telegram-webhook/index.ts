// lzd-telegram-webhook — receives Telegram bot updates.
// Validated via the x-telegram-bot-api-secret-token header set at setWebhook time.
// Commands: /start <code> (link account), /list, /pause, /resume.

import { createClient } from "npm:@supabase/supabase-js@2";
import { tgSendMessage, escapeHtml } from "./telegram.ts";

const STATUS_EMOJI: Record<string, string> = {
  in_stock: "🟢",
  out_of_stock: "🔴",
  unknown: "⚪",
  blocked: "🟠",
  error: "⚠️",
};

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: secrets, error: secErr } = await admin.rpc("lzd_get_secrets");
  if (secErr) return new Response("secrets_unavailable", { status: 500 });

  if (req.headers.get("x-telegram-bot-api-secret-token") !== secrets.LZD_TG_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string = (msg?.text ?? "").trim();
  if (!chatId || !text) return ok();

  const token = secrets.LZD_TELEGRAM_BOT_TOKEN;
  const reply = (html: string) => tgSendMessage(token, chatId, html);

  const { data: linked } = await admin
    .from("lzd_settings")
    .select("user_id, telegram_chat_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1]?.toLowerCase();
    if (linked) {
      await reply("✅ You're already linked. Restock alerts will arrive here.");
      return ok();
    }
    if (!code) {
      await reply("👋 Welcome! Open the monitor app → <b>Settings</b> and tap <b>Connect Telegram</b>, or send:\n<code>/start YOUR-LINK-CODE</code>");
      return ok();
    }
    const { data: row } = await admin
      .from("lzd_settings")
      .select("user_id")
      .eq("link_code", code)
      .maybeSingle();
    if (!row) {
      await reply("❌ That link code wasn't found. Copy it again from the app's Settings page.");
      return ok();
    }
    await admin
      .from("lzd_settings")
      .update({ telegram_chat_id: chatId, telegram_username: msg?.from?.username ?? null })
      .eq("user_id", row.user_id);
    await reply("🎉 <b>Linked!</b> You'll get instant restock alerts in this chat.");
    return ok();
  }

  if (!linked) {
    await reply("This bot isn't linked yet. Open the app's Settings page and connect Telegram first.");
    return ok();
  }

  if (text.startsWith("/list") || text.startsWith("/status")) {
    const { data: products } = await admin
      .from("lzd_products")
      .select("title, url, stock_status, is_active, last_price, currency")
      .eq("user_id", linked.user_id)
      .order("created_at");
    if (!products?.length) {
      await reply("No products monitored yet. Add one in the app!");
      return ok();
    }
    const lines = products.map((p) => {
      const emoji = p.is_active ? (STATUS_EMOJI[p.stock_status] ?? "⚪") : "⏸️";
      const price = p.last_price ? ` — ${p.currency} ${Number(p.last_price).toLocaleString("en-MY")}` : "";
      return `${emoji} <a href="${p.url}">${escapeHtml(p.title ?? p.url)}</a>${price}`;
    });
    await reply(`<b>Monitored products</b>\n\n${lines.join("\n")}`);
    return ok();
  }

  if (text.startsWith("/pause") || text.startsWith("/resume")) {
    const active = text.startsWith("/resume");
    await admin.from("lzd_products").update({ is_active: active }).eq("user_id", linked.user_id);
    await reply(active ? "▶️ Monitoring resumed for all products." : "⏸️ Monitoring paused for all products.");
    return ok();
  }

  await reply("Commands: /list — product status, /pause — pause all, /resume — resume all");
  return ok();
});

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
