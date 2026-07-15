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
The project name is historical and refers to the *project*, not to this app or only to the
other one. It also hosts the sibling app `financial-tracker/` (a memory-cycle signal desk).
**Everything this app owns is prefixed `lzd_`.**

- **Never touch** the sibling app's objects — everything prefixed `fin_` / `FIN_` / `fin-`:
  tables `fin_app_config`, `fin_contract_log`, `fin_catalysts`, `fin_snapshots`; edge
  function `fin-daily-signal`; cron job `fin-daily-signal`. (These were the unprefixed
  `app_config` / `contract_log` / `catalysts` / `snapshots` / `daily-signal` until
  2026-07-15 — if you find that old naming anywhere, it's stale.)
- All new tables/functions/cron jobs/secrets for this app **must** start with `lzd_` /
  `LZD_` / `lzd-`. This is the one rule that keeps the two apps from colliding.
- Two dead edge functions (`daily-signal`, `market-probe`) still exist pending manual
  deletion from the dashboard. They are nobody's — don't wire anything to them.

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

Web app "Add product" → validates the URL client-side (parseLazadaUrl in lib/supabase.ts)
       └─ inserts the row bare; the worker fills title/image/price/stock on its next pass

pg_cron "lzd-prune" (daily 03:15 UTC) → deletes old lzd_checks / lzd_notifications
```

That is the whole system. **There is no scraping API and no HTTP-fetch path any more** —
the worker's browser is the only thing that talks to Lazada. Removed on purpose (see
"Stock can only be read by a browser"): the `lzd-check-stock` / `lzd-product-preview` /
`lzd-scraper-usage` functions, the `lzd-tick` cron, the `lzd_fetch_state` table, and the
`LZD_SCRAPER_API_KEY` / `LZD_CRON_SECRET` secrets. Don't reintroduce them.

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
│   └── lzd-telegram-webhook/  index.ts + telegram.ts   (the only edge function left)
└── web/                           # Vite + React + TS + Tailwind v4
    └── src/
        ├── App.tsx        # auth gate, router, RealtimeBridge (invalidates queries on
        │                  #   lzd_products / lzd_notifications changes)
        ├── lib/supabase.ts   # client + types + fmtPrice() + parseLazadaUrl() + BOT_USERNAME
        ├── components/    Layout.tsx (sidebar shell), ui.tsx (design-system primitives)
        └── pages/         Login, Dashboard, Products, Notifications, Settings
```

## Data model (all RLS-enabled)

- `lzd_products` — one row per monitored URL. Key fields: `stock_status`
  (`in_stock|out_of_stock|unknown|blocked|error`), `check_interval_secs` (default 180),
  `burst_interval_secs` (default 30) + `burst_until`, `is_active`, `consecutive_errors`,
  `last_status_change_at`, `user_id`.
- `lzd_checks` — append-only check log (`fetch_method` is `browser`; older rows may say
  `direct`/`scrape_api` from the retired HTTP checker).
- `lzd_notifications` — sent alerts (`type` = `restock|error|test`).
- `lzd_settings` — one row/user: `telegram_chat_id`, `link_code`, defaults, retention.

RLS pattern: user tables are owner-only (`user_id = auth.uid()`), matching the EVOne app's
convention. Schema is already multi-user-ready even though there's one user today. The
worker uses the service_role key, so RLS doesn't apply to it.

## Secrets — never hardcode, never put in migrations

Stored in **Supabase Vault** with the `LZD_` prefix; read only via the
`service_role`-restricted RPC `public.lzd_get_secrets()` (returns a JSONB of all `LZD_*`).
Callers use `admin.rpc("lzd_get_secrets")`. Current secrets — only two:

- `LZD_TELEGRAM_BOT_TOKEN` — used by the worker (alerts) and the webhook (replies)
- `LZD_TG_WEBHOOK_SECRET` — validates Telegram's `x-telegram-bot-api-secret-token`

The webhook secret is injected into the `setWebhook` call via `execute_sql` — **keep it
out of `apply_migration`** so it never lands in committed migration history. The worker's
own credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) live in `fly secrets`, not
in Vault and not in the repo. The only secrets in the repo are the frontend's publishable
values in `web/.env` (Supabase URL + publishable key), which are safe to expose.

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

Paths that were investigated and rejected (don't redo this work):
- *ScraperAPI* plain fetch: returns the same stock-independent HTML — useless for stock.
  **The whole ScraperAPI integration was therefore deleted**; the browser needs no proxy
  (it passes anti-bot from a plain datacenter IP with no captcha).
- *ScraperAPI `render=true`*: 500s on Lazada, and premium proxies (which its own error
  recommends) are not on the current plan (403). Also ~57 s and 10–25 credits per check.
- *Signed mtop API* (`mtop.lazada.detail.*` on `acs-m.lazada.com.my`): token+md5 signing
  works, but the detail endpoints need Alibaba's rotating `x-sgext`/`x-mini-wua` anti-bot
  headers → `FAIL_SYS_ILLEGAL_ACCESS`. Too fragile to depend on.

Metadata (title/image/price/currency) *is* reliable in the HTML, but we no longer fetch it
separately — the worker reads it from the same page load as the stock check.

## Don't lower the check interval below ~60s — it backfires

Checks cost nothing per request, so the temptation is to poll hard. **Measured 2026-07
from Fly/sin at a 10s interval, Lazada silently throttles**: latency decayed
6s → 21s → 45s (timeout) → **89s** within ~2 minutes. It never returns a captcha or an
error page — it just tarpits the connection, so the data stays correct while the achieved
cadence collapses to ~80s, i.e. *worse than asking for 60s*. Backing off to 60s made it
decay back down (31s → 18s → baseline).

So the interval is self-defeating below some threshold: **60s is the tested sweet spot.**
If you revisit this, the canaries are median speed and "Captcha / blocked" on the
dashboard — a creeping median means throttling, not a slow network.

Worker tunables: `TICK_MS`, `JITTER_MS` (env); `ERROR_BACKOFF_AFTER` (5 consecutive
errors → 15 min), `BROWSER_RECYCLE_CHECKS` (200) in `worker/src/index.js`. A healthy
check is ~6–7 s (page load dominates; the hydration wait is adaptive, ~0.2–1.4 s).

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
  mirror, not an auto-deploy. Only `lzd-telegram-webhook` remains, with `verify_jwt: false`
  (it authenticates via Telegram's secret-token header instead).
  Note: the MCP has no delete-function tool — retired functions must be removed from the
  Supabase dashboard by hand.
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

## Telegram logic lives in two places

There are two independent copies of the Telegram send logic, by necessity — they run on
different platforms and cannot import each other:

- `worker/src/telegram.js` (Node, on Fly) — sends the restock alert
- `supabase/functions/lzd-telegram-webhook/telegram.ts` (Deno, on Supabase) — bot replies

If you change message formatting or the send call, check whether both need it.
(This used to be a worse 4-copy problem across edge functions; deleting the HTTP checker
and preview removed the `lazada.ts` duplication entirely — stock logic now exists once, in
`worker/src/lazada.js`.)

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
- **The shell is responsive and is shared-by-convention with `financial-tracker/`** — the two
  `Layout` files have no shared code, so changes must be applied by hand to both. Below `lg`
  the sidebar is an off-canvas drawer behind a hamburger; at `lg`+ it's static (`lg:ml-60`).
  Gotchas: the header must stay **`z-20`** (aside 40 > backdrop 30 > header 20, or the header
  paints over the backdrop and stays clickable); `NavLink` needs `onClick` to close *as well
  as* the `pathname` effect (tapping the current route doesn't change `pathname`).
  Wide tables need `overflow-x-auto` + a `min-w-[…]` (see `Products.tsx`) so the table
  scrolls inside its card instead of the whole page.
- Don't fabricate `stock_status` in the DB to "test" while checks are in flight — the next
  real check overwrites it. To test an alert, pause the product first, set
  `out_of_stock`, then reactivate (see README).

## Housekeeping note

`web/tsconfig.tsbuildinfo` is a build artifact that slipped into git; it's ignored going
forward. Don't commit build outputs (`dist/`, `*.tsbuildinfo`, `node_modules/`).
