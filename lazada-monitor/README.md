# Lazada Restock Monitor

Personal tool: monitors Lazada product pages and sends an instant Telegram alert
(via **@pokemonAIO_bot**) when a product goes from out-of-stock to in-stock.

Backend lives in the **DRAM** Supabase project (`vjqbircarzxcxrdzlyxj`, "Personal Tools" org).
All database objects are prefixed `lzd_` and coexist with the DRAM tool's tables.
Stock checking runs on a small **Fly.io worker** (Playwright).

## Architecture

```
Fly.io worker (worker/)  ── Playwright/Chromium ──▶ lazada.com.my / lazada.sg / …
  loop:
   ├─ pick active products that are due (per-product interval, burst-aware)
   ├─ load the real page, wait for hydration, look for a live "Add to Cart" button
   ├─ write lzd_checks + update lzd_products     ──▶ Supabase
   └─ on out_of_stock → in_stock: Telegram alert ──▶ your phone

Supabase: Postgres + RLS (data), Auth (single user), Realtime (live dashboard),
          Edge Fn lzd-telegram-webhook (bot linking + /list, /pause, /resume),
          pg_cron lzd-prune (nightly history cleanup)

Web app (web/): React dashboard — products, notifications, settings
```

### Why a real browser (important)

Lazada's server-rendered HTML **never reflects real stock**: `offers.availability` is
always `InStock`, every SKU's button state is always an enabled "Add to Cart", and the
module list always contains add-to-cart — even for a product that is genuinely out of
stock. Availability is applied client-side after hydration.

So no HTTP fetch or HTML parser can read stock. (The original ScraperAPI-based checker
reported `in_stock` forever and therefore could never detect a restock — it silently never
alerted. That whole integration has been removed.) The only reliable signal is whether a
real **"Add to Cart" / "Buy Now"** button exists in the loaded page.

Verified: known-OOS box → `out_of_stock`; known in-stock pack → `in_stock`; delisted item
→ `out_of_stock`. No captcha from a plain datacenter IP, so no proxy is needed.

Bonus: the browser costs **nothing per check**, so short intervals are free.

## Worker (`worker/`)

Owns all stock checking. See [worker/README.md](worker/README.md) for deploy steps.

```bash
cd worker
npm install && npx playwright install chromium
node src/selftest.js     # verify the detector against real pages — no DB/secrets needed
fly deploy               # deploy to Fly.io
fly logs                 # watch checks land
```

Keep `fly scale count 1` — two machines would double-check and could double-alert.

## Web app (`web/`)

React + Vite + TypeScript + Tailwind v4. Pages: Dashboard (stats, checker health,
activity), Products (add/pause/burst/delete + check history), Notifications (alert log),
Settings (Telegram linking, defaults, password).

```bash
cd web
npm install
npm run dev      # local dev
npm run build    # production build (deploy dist/ to Vercel/Netlify/anything static)
```

Environment (already in `web/.env`, publishable values only):

- `VITE_SUPABASE_URL=https://vjqbircarzxcxrdzlyxj.supabase.co`
- `VITE_SUPABASE_KEY=sb_publishable_9i-1BFr30Qx9o5g9ZJFWXQ_Wgk8AT5K`

Note: the app uses client-side routing — when deploying, add a SPA rewrite
(all routes → `/index.html`).

## Operational notes

- **Adding a product**: paste any Lazada product URL (any country domain). The URL is
  validated in the browser; the worker fills in name/photo/price/stock on its first pass
  and the table updates live.
- **Burst mode** (⚡ on a product row): checks every 30 s for 30 minutes — use when a drop
  is expected. Per-product interval is 30 s – 1 h; a check takes ~7–9 s.
- **Blocked / error status**: after 5 consecutive failed checks a product's effective
  interval stretches to 15 min until a real status is read again (self-healing backoff).
  The dashboard's "Checker health" card shows recent check outcomes.
- **Secrets**: only `LZD_TELEGRAM_BOT_TOKEN` and `LZD_TG_WEBHOOK_SECRET` in Supabase Vault
  (read via the service-role-only `lzd_get_secrets()` RPC). The worker's Supabase
  credentials live in `fly secrets`.
- Telegram webhook re-registration (e.g. after changing the secret):
  `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with the function URL and
  `secret_token`.

## Edge function source

`supabase/functions/` mirrors what is deployed. Deploys are done via the Supabase MCP
(`deploy_edge_function`); redeploy the same way after edits.
