# CLAUDE.md — Lazada Restock Monitor

Conventions and workflow for this app. Read before changing code. Keep this file in
sync when architecture, secrets, or deploy steps change.

## What this is

A single-user tool that monitors Lazada Malaysia product pages and sends an instant
Telegram alert when a product flips from **out of stock → in stock**. Backend is
Supabase (Postgres + pg_cron + Edge Functions); frontend is a React/Vite SaaS
dashboard. Owner: jared@voltara.com.my. Alerts go through Telegram bot **@pokemonAIO_bot**.

## Backend lives in a SHARED Supabase project — read this first

Project **DRAM** (`vjqbircarzxcxrdzlyxj`, org "Personal Tools" `kwuuwijzamsjkwvdlquk`).
This project also hosts an unrelated market-signal tool. **Everything this app owns is
prefixed `lzd_`.**

- **Never touch** these pre-existing objects: tables `contract_log`, `app_config`,
  `catalysts`, `snapshots`; edge functions `daily-signal`, `market-probe`.
- All new tables/functions/cron jobs/secrets for this app **must** start with `lzd_` /
  `LZD_` / `lzd-`. This is the one rule that keeps the two apps from colliding.

## Architecture / data flow

```
Fly.io worker (worker/, Playwright + Chromium)   <-- owns stock checking
  loop:
   ├─ select active products due (interval / burst / error-backoff)
   ├─ real browser loads page, waits for hydration, looks for "Add to Cart"
   ├─ insert lzd_checks row; update lzd_products
   └─ if out_of_stock→in_stock: Telegram sendMessage + insert lzd_notifications

Edge Fn lzd-telegram-webhook  ← Telegram bot updates (auth: x-telegram-bot-api-secret-token)
       └─ /start <link_code> links chat; /list, /pause, /resume
Edge Fn lzd-product-preview   ← web app "Add product" (JWT) → metadata only, stock=unknown
Edge Fn lzd-scraper-usage     ← web app dashboard card (JWT) → proxies ScraperAPI /account

pg_cron "lzd-prune" (daily 03:15 UTC) → deletes old lzd_checks / lzd_notifications

DEPRECATED (disabled, do not re-enable):
  pg_cron "lzd-tick" + Edge Fn lzd-check-stock — HTTP-fetch checker. Superseded because
  HTTP fetch cannot read Lazada stock at all (see "Stock can only be read by a browser").
```

## Repo layout

```
lazada-monitor/
├── CLAUDE.md          ← this file
├── README.md          ← runbook + Lazada parsing calibration notes
├── PLAN.md            ← original design/plan (historical)
├── worker/            # Fly.io Playwright worker — OWNS stock checking (see its README)
│   ├── src/index.js       # the loop: due products -> check -> log -> alert
│   ├── src/lazada.js      # browser stock detection (the reliable signal)
│   ├── src/selftest.js    # `node src/selftest.js` — verify detector, no DB/secrets
│   └── Dockerfile + fly.toml
├── supabase/functions/            # mirror of what's deployed; deploy via Supabase MCP
│   ├── lzd-check-stock/   DEPRECATED (HTTP checker; cannot read stock) — cron disabled
│   ├── lzd-telegram-webhook/  index.ts + telegram.ts
│   ├── lzd-product-preview/   index.ts + lazada.ts
│   └── lzd-scraper-usage/     index.ts
└── web/                           # Vite + React + TS + Tailwind v4
    └── src/
        ├── App.tsx        # auth gate, router, RealtimeBridge (invalidates queries on
        │                  #   lzd_products / lzd_notifications changes)
        ├── lib/supabase.ts   # client + shared types + fmtPrice() + BOT_USERNAME
        ├── components/    Layout.tsx (sidebar shell), ui.tsx (design-system primitives)
        └── pages/         Login, Dashboard, Products, Notifications, Settings
```

## Data model (all RLS-enabled)

- `lzd_products` — one row per monitored URL. Key fields: `stock_status`
  (`in_stock|out_of_stock|unknown|blocked|error`), `check_interval_secs` (default 180),
  `burst_interval_secs` (default 30) + `burst_until`, `is_active`, `consecutive_errors`,
  `last_status_change_at`, `user_id`.
- `lzd_checks` — append-only check log (`fetch_method` is `direct|scrape_api`).
- `lzd_notifications` — sent alerts (`type` = `restock|error|test`).
- `lzd_settings` — one row/user: `telegram_chat_id`, `link_code`, defaults, retention.
- `lzd_fetch_state` — single row (id=1), **service-role only** (RLS on, no policies —
  the "RLS enabled, no policy" advisor warning on this table is intentional). Holds
  `blocked_until` cooldown + direct/scrape counters.

RLS pattern: user tables are owner-only (`user_id = auth.uid()`), matching the EVOne app's
convention. Schema is already multi-user-ready even though there's one user today.

## Secrets — never hardcode, never put in migrations

Stored in **Supabase Vault** with the `LZD_` prefix; read only via the
`service_role`-restricted RPC `public.lzd_get_secrets()` (returns a JSONB of all `LZD_*`).
Edge functions call `admin.rpc("lzd_get_secrets")`. Current secrets:
`LZD_TELEGRAM_BOT_TOKEN`, `LZD_SCRAPER_API_KEY`, `LZD_CRON_SECRET`, `LZD_TG_WEBHOOK_SECRET`.

- The cron secret and webhook secret are injected into cron SQL / setWebhook calls
  directly via `execute_sql` — **keep them out of `apply_migration`** so they never land
  in committed migration history.
- The only secrets in the repo are the frontend's publishable values in `web/.env`
  (Supabase URL + publishable key), which are safe to expose.

## Stock can only be read by a browser (the single most important fact here)

**Lazada's server-rendered HTML is stock-independent.** Verified exhaustively 2026-07
against a product that was genuinely out of stock:

- schema.org `offers.availability` → always `InStock`
- every SKU's `operation` → always `{text: "Add to Cart", disable: false}`
- the SSR module list → always contains `module_add_to_cart`, never a notify/subscribe module
- desktop and `h5.` mobile HTML are the same bytes

Real availability is applied **client-side after hydration**. So no HTTP fetch and no
HTML parser can determine stock — the original checker read `InStock` forever and could
therefore never observe an `out_of_stock → in_stock` transition (it silently never
alerted). Don't "fix" this by finding a better regex; the data is not in the HTML.

**The reliable signal**: does a real "Add to Cart"/"Buy Now" button exist in the loaded
page? That's what `worker/src/lazada.js` checks, and why the worker exists.

Paths that were investigated and rejected:
- *ScraperAPI `render=true`*: 500s on Lazada, and premium proxies (which its own error
  recommends) are not on the current plan (403). Also ~57 s and 10–25 credits per check.
- *Signed mtop API* (`mtop.lazada.detail.*` on `acs-m.lazada.com.my`): token+md5 signing
  works, but the detail endpoints need Alibaba's rotating `x-sgext`/`x-mini-wua` anti-bot
  headers → `FAIL_SYS_ILLEGAL_ACCESS`. Too fragile to depend on.

Metadata (title/image/price/currency) *is* reliable in the HTML — that's all
`lzd-product-preview` uses it for, and it now reports `stock_status: "unknown"`.

Worker tunables: `TICK_MS`, `JITTER_MS` (env); `ERROR_BACKOFF_AFTER` (5 consecutive
errors → 15 min), `BROWSER_RECYCLE_CHECKS` (200) in `worker/src/index.js`. A check takes
~7–9 s and costs **no** scraping credits, so 15–30 s intervals are practical.

## Local development

The app is in the **`web/` subfolder** — a bare `npm run dev` at the repo root fails.

```bash
cd lazada-monitor/web
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build — run this before committing frontend changes
```

`vite.config.ts` sets `server.host: true, allowedHosts: true` so the GitHub Codespaces
forwarded domain (`*.app.github.dev`) works — don't remove it or Codespace previews break.

## Deploying changes

- **Edge functions**: deploy with the Supabase MCP `deploy_edge_function` (per-folder).
  There is no `supabase` CLI login here; the `supabase/functions/` tree is the source
  mirror, not an auto-deploy. `verify_jwt`: **false** for `lzd-check-stock` and
  `lzd-telegram-webhook` (they do their own header-secret auth), **true** for
  `lzd-product-preview` and `lzd-scraper-usage`.
- **Schema**: DDL via MCP `apply_migration` (snake_case name); ad-hoc/secret-bearing SQL
  via `execute_sql`. Run `get_advisors` after DDL. New functions need
  `set search_path = ''`.
- **Frontend**: `npm run build`, deploy `web/dist/` to any static host (Vercel). **Add a
  SPA rewrite** (all routes → `/index.html`) — the app uses client-side routing.

## Deploying the worker

`cd worker && fly deploy` (see `worker/README.md`). Secrets live in `fly secrets`
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — the bot token is read from Vault via
`lzd_get_secrets()`, so it is not duplicated there. Keep `fly scale count 1`: two
machines would double-check and could double-alert.

## Shared-module gotcha (easy to get wrong)

`lazada.ts` and `telegram.ts` are **duplicated** into each function folder that needs them
(edge deploys are per-folder; there's no shared import across functions). When you change
fetch/parse or Telegram logic, **update every copy**:

- `lazada.ts` → `lzd-check-stock/` and `lzd-product-preview/`
- `telegram.ts` → `lzd-check-stock/` and `lzd-telegram-webhook/`

…then redeploy each affected function. Keeping them byte-identical is the intent.

## Conventions / invariants

- **`lzd_` / `LZD_` / `lzd-` prefix on everything.** (Restated because it's the big one.)
- Secrets only via Vault + `lzd_get_secrets()`; never in code, migrations, or client.
- RLS on every user table, owner-scoped; carry `user_id` even while single-user.
- Restock = new status `in_stock` **and** the last *real* status (ignoring
  `unknown/blocked/error`) was `out_of_stock`. Don't simplify to "status changed".
- UI design system: dark slate sidebar, indigo primary, stat cards + tables (matches the
  EVOne/Voltara house style). Status colors are fixed: in_stock=emerald,
  out_of_stock=red, blocked=amber, error=orange, unknown=slate. Reuse the primitives in
  `components/ui.tsx` (Button, Card, StatusBadge, Modal, Switch, StatCard, …) rather than
  ad-hoc markup.
- Don't fabricate `stock_status` in the DB to "test" while checks are in flight — the next
  real check overwrites it. To test an alert, pause the product first, set
  `out_of_stock`, then reactivate (see README).

## Housekeeping note

`web/tsconfig.tsbuildinfo` is a build artifact that slipped into git; it's ignored going
forward. Don't commit build outputs (`dist/`, `*.tsbuildinfo`, `node_modules/`).
