# Lazada stock worker (Fly.io)

Runs a real Chromium via Playwright, checks each active product, writes results to
Supabase, and fires the Telegram restock alert. Replaces the old
`pg_cron -> lzd-check-stock -> HTTP fetch` path.

## Why this exists

Lazada's server-rendered HTML is **stock-independent**: `offers.availability` is always
`InStock`, every SKU's `operation` is always `Add to Cart`, and the module list always
contains add-to-cart — no matter the real availability, which is applied client-side
after hydration. So no cheap HTTP fetch (and no HTML parser) can tell stock; the old
checker therefore reported everything as in stock forever and could never detect a
restock. Supabase Edge Functions run Deno and cannot launch a browser, so the check moved
here.

The reliable signal: **does a real "Add to Cart" / "Buy Now" button exist in the loaded
page?** Verified against a known-OOS box (no cart button), a known in-stock pack (cart
button present), and a delisted item ("no longer available").

Bonus: this uses **zero ScraperAPI credits**, so short intervals are free.

## Deploy

Prereq: [flyctl](https://fly.io/docs/flyctl/install/) + a Fly account.

```bash
cd lazada-monitor/worker

fly auth login
fly launch --no-deploy --copy-config --name lazada-monitor-worker --region sin
```

Set secrets (never commit these):

```bash
fly secrets set \
  SUPABASE_URL="https://vjqbircarzxcxrdzlyxj.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
```

Get the service_role key from **Supabase → Project Settings → API Keys → service_role**.
It bypasses RLS — treat it like a password, and only ever put it in `fly secrets`.
The Telegram bot token is *not* needed here: the worker reads it from Supabase Vault via
the `lzd_get_secrets()` RPC.

Then:

```bash
fly deploy
fly logs        # watch checks land
```

Keep exactly **one** machine running — two would double-check and could double-alert:

```bash
fly scale count 1
```

## Local run

```bash
npm install
npx playwright install chromium

# no DB/secrets needed — verifies the stock detector against real pages
node src/selftest.js

# full loop (needs the two env vars above)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start
```

## Monitoring

The worker writes a heartbeat to `lzd_worker_state` on **every loop pass** (started_at,
last heartbeat, machine id, region, checks completed/failed, browser restarts, last
error). The dashboard's **"Monitor worker"** card reads it and shows:

- **Online / Stale / Offline** — stale means no heartbeat for >90 s, i.e. the worker is
  wedged or dead and restocks are silently not being detected. This is the single most
  important thing to watch.
- Uptime, checks completed/failed, browser restarts, last error
- An estimated Fly cost for the current run and per month

Deliberately no Fly API token required: the heartbeat answers "is it running?", which is
what actually matters. Fly's own dashboard remains the source of truth for billing; the
cost figure here is derived from the `fly.toml` VM size × observed uptime and is only a
sanity check.

Useful commands:

```bash
fly status      # machine state as Fly sees it
fly logs        # live check output
fly machine restart <id>
```

## Tuning

| Env | Default | Meaning |
|---|---|---|
| `TICK_MS` | `5000` | pause between loop passes |
| `JITTER_MS` | `4000` | random 0–N ms between products, so requests aren't metronomic |

Per-product interval still comes from `lzd_products.check_interval_secs` (and
`burst_interval_secs` / `burst_until`) — set them in the dashboard. A check takes ~7–9 s.
Since there are no per-request credits, 15–30 s intervals are practical; going much
lower mainly risks drawing anti-bot attention from a single IP.

Memory: Chromium needs ~1 GB (`fly.toml` sets it). Below ~512 MB it OOMs.

## Notes

- The old `lzd-check-stock` edge function and its `lzd-tick` cron job are **superseded and
  disabled**. Don't re-enable the cron — it would write wrong statuses again.
- `lzd-product-preview` still uses HTTP (title/image/price are reliable there) but now
  reports `stock_status: "unknown"`; this worker resolves real stock on its first pass.
