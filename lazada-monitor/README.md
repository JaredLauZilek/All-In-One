# Lazada Restock Monitor

Personal tool: monitors Lazada product pages and sends an instant Telegram alert
(via **@pokemonAIO_bot**) when a product goes from out-of-stock to in-stock.

Backend lives in the **DRAM** Supabase project (`vjqbircarzxcxrdzlyxj`, "Personal Tools" org).
All database objects are prefixed `lzd_` and coexist with the DRAM tool's tables.

## Architecture

- **pg_cron `lzd-tick`** (every 30 s) → `net.http_post` → **`lzd-check-stock`** edge function
- The checker selects products due (per-product interval, burst-aware), fetches each page:
  1. **Direct fetch** (free, ~1 s) — works as of 2026-07; Lazada serves full HTML to plain requests
  2. **ScraperAPI fallback** (~12 s, uses credits) — automatic when direct fetch gets blocked;
     direct is put on a 10-min cooldown after a block
- Stock parsed from the schema.org **Product JSON-LD** (`offers.availability`); price from
  `__moduleData__` (`pdt_price`); title/image from JSON-LD
- On `out_of_stock → in_stock`, a Telegram message is sent immediately and logged in
  `lzd_notifications`
- **`lzd-telegram-webhook`** handles `/start <link-code>` account linking plus `/list`,
  `/pause`, `/resume`
- **`lzd-product-preview`** powers the add-product preview in the UI
- **pg_cron `lzd-prune`** (daily 03:15 UTC) deletes old check logs

Secrets (bot token, ScraperAPI key, cron secret, webhook secret) are stored in **Supabase
Vault** and exposed to edge functions only through the `service_role`-restricted RPC
`lzd_get_secrets()`.

## Web app (`web/`)

React + Vite + TypeScript + Tailwind v4. Pages: Dashboard (stats, health, activity),
Products (add/pause/burst/delete + check history), Notifications (alert log),
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

- **Burst mode** (⚡ on a product row): checks every 30 s for 30 minutes — use when a drop
  is expected. Baseline default is 3 min (configurable per product: 1 min – 1 h).
- **Blocked status** on a product means both fetch tiers failed; the dashboard's
  "Checker health" card shows direct-vs-ScraperAPI ratio and block rate.
- ScraperAPI credits are only consumed on fallback. If Lazada starts blocking datacenter
  IPs consistently, most checks will shift to ScraperAPI — watch usage at scraperapi.com.
- After 5 consecutive failed checks on a product, its effective interval is stretched to
  15 min until a real status is read again (self-healing backoff).
- Telegram webhook re-registration (e.g. after changing the secret):
  `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with the function URL and
  `secret_token`.

## Edge functions source

`supabase/functions/` in this folder mirrors what is deployed. Deploys were done via the
Supabase MCP (`deploy_edge_function`); redeploy the same way after edits.
