# Lazada Restock Monitor — Architecture & Build Plan

Personal tool for Jared: monitor Lazada product pages for restocks and push a Telegram
alert the moment stock is detected. Lives in the **DRAM** Supabase project
(`vjqbircarzxcxrdzlyxj`, "Personal Tools" org) alongside the existing DRAM tables/functions,
which we will not touch. All new objects are prefixed `lzd_`.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Backend | Existing **DRAM** Supabase project (pg_cron 1.6.4 + pg_net already installed ✓) |
| Accounts | Single user (Supabase Auth, signups disabled), schema multi-user-ready (`user_id` everywhere) |
| Stock fetching | Tiered: cheap direct fetch w/ session reuse → scraping-API fallback (pluggable provider) |
| Check frequency | Baseline 3 min per product (configurable), **burst mode 30–60 s** per product; cron ticks every 30 s |
| Notifications | Telegram bot (BotFather), sub-second delivery once restock detected |
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui, SaaS layout (sidebar + topbar), TanStack Query, Supabase Realtime |

### Why not every second
Lazada runs layered anti-bot (JS-loaded data, fingerprinting, session validation, IP rate
limits). 1 req/s from a fixed datacenter IP is blocked within minutes, and via a scraping
API it is ~2.6 M requests/month/product (thousands of USD). The tiered design below gets
sustained ~3-min detection and ~30–60 s during burst windows, which is the practical
ceiling for a serverless personal tool.

## Architecture

```
┌────────────────────┐        ┌───────────────────────────────────────────────┐
│  React SPA (Vite)  │  HTTPS │  Supabase (DRAM project)                      │
│  SaaS dashboard    │───────▶│                                               │
│  - Dashboard       │        │  Auth (single user) · Postgres + RLS          │
│  - Products        │◀───────│  Realtime (live status flips in UI)           │
│  - Notifications   │  WS    │                                               │
│  - Settings        │        │  pg_cron ── every 30 s ──▶ pg_net HTTP        │
└────────────────────┘        │                    │                          │
                              │                    ▼                          │
                              │  Edge Fn: lzd-check-stock                     │
                              │   1. select products due (interval/burst)     │
                              │   2. fetch via tiered checker ────────────────┼──▶ Lazada page
                              │      a) direct fetch reusing warmed session   │    (embedded JSON:
                              │      b) on block → scraping API provider      │     stock/price/title)
                              │   3. parse stock + price, log lzd_checks      │
                              │   4. OOS→in-stock? ──▶ Telegram sendMessage ──┼──▶ your phone
                              │                                               │
                              │  Edge Fn: lzd-telegram-webhook ◀──────────────┼─── /start link code
                              │  Edge Fn: lzd-product-preview (add-URL flow)  │
                              └───────────────────────────────────────────────┘
```

## Database (migrations via Supabase MCP)

- `lzd_products` — url, lazada item/sku id, title, image_url, shop_name, last_price,
  currency, `stock_status` (in_stock | out_of_stock | unknown | blocked | error),
  `check_interval_secs` (default 180), `burst_until` + `burst_interval_secs` (default 30),
  `is_active`, `consecutive_errors`, `last_checked_at`, `last_status_change_at`, `user_id`.
- `lzd_checks` — per-check log: status, price, `fetch_method` (direct | session | scrape_api),
  http_status, latency_ms, error. Daily cron prunes rows older than 30 days.
- `lzd_notifications` — type (restock | error | test), message, telegram_message_id, status.
- `lzd_settings` — telegram_chat_id, link_code, default intervals, retention days.
- RLS on all tables (owner-only, matching EVOne conventions). Secrets (Telegram bot token,
  scraping-API key) live in Edge Function secrets, never in tables.
- Cron jobs: `lzd-tick` every 30 s → pg_net POST to `lzd-check-stock`; `lzd-prune` daily.

## Edge Functions (Deno, deployed via MCP)

1. **lzd-check-stock** (`verify_jwt` false + shared-secret header, called by pg_cron)
   - Pulls all products where `now() >= last_checked_at + effective_interval` (burst-aware).
   - Tiered checker module (pluggable): try direct fetch with stored warmed cookies →
     detect block/captcha page → fall back to scraping-API provider (env-selected:
     scraperapi | zenrows | scrapeless) → re-warm session cookies from its response.
   - Parses stock/price from the JSON embedded in the product page HTML.
   - Detects `out_of_stock → in_stock` transition → immediately calls Telegram
     `sendMessage` (product name, price, inline "Open product" button) → logs notification.
   - Error hygiene: `consecutive_errors` backoff, mark `blocked` status so the UI shows
     checker health honestly.
2. **lzd-telegram-webhook** — bot webhook (secret-token validated): `/start <code>` links
   your chat_id; `/list`, `/pause` convenience commands.
3. **lzd-product-preview** — UI calls this when adding a URL: one fetch → returns
   title/image/price/current stock for confirmation before saving.

## Frontend (`lazada-monitor/` in this repo)

Vite + React + TS + Tailwind + shadcn/ui + TanStack Query + Recharts + supabase-js.

- **Dashboard** — stat cards (active monitors, in stock, out of stock, alerts 24 h),
  recent status-change feed, checker health (last tick, block rate). Live via Realtime.
- **Products** — table (image, title, price, status badge, interval, last checked),
  Add Product dialog (paste URL → live preview → save), per-product detail with check
  timeline + price history chart, burst-mode toggle, pause/delete.
- **Notifications** — alert log with links to product and Lazada page.
- **Settings** — Telegram connect flow (deep-link `t.me/<bot>?start=<code>` + "send test
  message"), default intervals, scraping-API provider status, retention.
- Deploy: Vercel (or run locally); env = Supabase URL + publishable key only.

## Build order

1. Migrations (tables, RLS, indexes, cron jobs).
2. `lzd-check-stock` + parser; calibrate against real lazada.com.my product pages and
   measure whether raw HTML (no JS render) carries stock JSON — this decides scraping-API
   credit cost. Wire provider fallback.
3. Telegram: bot token secret, webhook registration, linking flow, restock message.
4. Frontend app (auth, layout, 4 pages, realtime).
5. End-to-end verify: add a real OOS product, watch checks land in `lzd_checks`,
   force a restock transition, confirm Telegram alert < 2 s after detection.
6. Deploy frontend to Vercel.

## Needed from Jared

1. **Telegram bot token** — @BotFather → `/newbot` → send me the token (I'll store it as an
   Edge Function secret).
2. **Scraping-API account** — recommend starting a free trial (ScraperAPI / ZenRows /
   Scrapeless) and sending the API key; app runs in direct-only mode without it, but
   reliability against blocks needs it.
3. **2–3 Lazada product URLs** to monitor/test (ideally one currently out of stock).
