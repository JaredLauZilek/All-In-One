# CLAUDE.md — Financial Tracker

Conventions and workflow for this app. Read before changing code. Keep this file in
sync when architecture, secrets, or deploy steps change.

## What this is

A single-user daily monitoring cockpit for the memory-stock cycle (MU, SNDK, WDC, DRAM).
A React SPA reads one pre-computed verdict per day from Supabase; a Deno edge function
computes that verdict once a day from Finnhub quotes + hand-logged DDR5 contract prices.
Owner: jared@voltara.com.my.

The product philosophy governs the code: **it defaults to Hold and only escalates.** Most
days it should tell the user to do nothing.

Formerly the standalone **DRAM** repo (`memory-cycle-signal`); moved into All-In-One
2026-07-15. Pre-move git history lives only in that old repo — this folder starts fresh.

## This is one app in the All-In-One monorepo

```
All-In-One/
├── lazada-monitor/     # Lazada restock monitor — owns everything lzd_
└── financial-tracker/  # ← you are here — owns everything fin_
```

Sibling apps are **independent**: separate `package.json`, separate deploys, no shared
code, no root workspace wiring. There is no build at the repo root — always work from
inside the app folder.

## Backend lives in a SHARED Supabase project — read this first

Project **DRAM** (`vjqbircarzxcxrdzlyxj`, org "Personal Tools" `kwuuwijzamsjkwvdlquk`,
region `ap-northeast-2` Seoul). The project is *named* DRAM for historical reasons — that
name refers to the Supabase project, **not** to this app, and not only to this app. It
also hosts the Lazada restock monitor. **Everything this app owns is prefixed `fin_`.**

- **Never touch** these objects — they belong to `lazada-monitor/`: tables `lzd_products`,
  `lzd_checks`, `lzd_notifications`, `lzd_settings`, `lzd_worker_state`; edge function
  `lzd-telegram-webhook`; cron job `lzd-prune`; RPC `lzd_get_secrets()`; `LZD_*` secrets.
- All tables/functions/cron jobs/secrets for this app **must** start with `fin_` / `FIN_` /
  `fin-`. This is the one rule that keeps the two apps from colliding.

## Architecture / data flow

Data flows in one direction, and the two writers own disjoint fields (they share the
`fin_app_config` row but never set the same columns):

```
Finnhub /quote ─┐   (US names only — free tier is US-only)
Yahoo  /chart ──┤   (52-wk high + currency for ALL; price for the Korean names)
Bing News RSS ──┤   (DDR5 intel = advisory · semiconductor news = INERT)
                ▼
        fin-daily-signal (edge fn, Deno, SERVICE ROLE)
   reads fin_app_config + fin_catalysts + fin_contract_log
   computes ONE verdict ──> writes fin_snapshots (one row/day)
                            + .intel (advisory DDR5 read)
                            + .news  (10-item reading list, inert)
                            + auto-tracks fin_app_config.peaks (Yahoo 52-wk high)
                                   │
                                   ▼
        React app (anon key) reads fin_snapshots[latest]  ──> Desk tab
                                                          ──> News tab (.news only)
        React app (anon key) writes fin_app_config / fin_contract_log / fin_catalysts
                                                          ──> Settings tab

pg_cron "fin-daily-signal" (daily 23:00 UTC = 07:00 MYT) → POSTs the anon JWT to the fn
```

## Repo layout

```
financial-tracker/
├── CLAUDE.md          ← this file
├── README.md          ← runbook
├── .env               ← gitignored; see "Frontend env" below
├── vercel.json        ← SPA rewrite — required, the app uses client-side routing
├── src/
│   ├── App.jsx           # data loading + router; passes state via Outlet context
│   ├── index.css         # Tailwind entry (~10 lines) — no bespoke CSS
│   ├── components/
│   │   ├── Layout.jsx    # responsive sidebar shell (drawer < lg) + header + footer
│   │   └── ui.jsx        # design-system primitives — mirror of lazada-monitor's ui.tsx
│   ├── lib/
│   │   ├── supabase.js   # client + refreshNow()
│   │   └── signal.js     # cycleRead() + NAMES + fmtMoney/fmtAgo/fmtNewsDate + numObj()
│   └── pages/
│       ├── Desk.jsx      # verdict, prices, contract trigger, cycle, catalysts, journal
│       ├── News.jsx      # daily semiconductor reading list (INERT — see below)
│       └── Settings.jsx  # levels, log a print, catalyst outcomes
└── supabase/
    ├── functions/fin-daily-signal/index.ts   # the ONLY place verdict logic lives
    └── migrations/                           # canonical schema; 0001-0004 use OLD names
```

- **`src/App.jsx`** owns all data. `loadAll()` fetches the 4 tables in parallel on mount and
  hands them to pages through the router's **Outlet context**; every mutation calls
  `reload()`. There's no react-query here (the sibling app needs it for 30s polling; this
  verdict changes once a day — nothing to poll).
- The **Desk renders even without a snapshot** — only the verdict card and price cards need
  `snap`; the cycle meter, contract log, catalysts, and journal are driven by
  `log`/`cats`/`cfg` and show regardless. The Desk is otherwise read-only *except* the
  **decision journal**, which autosaves to `fin_app_config.journal` — a deliberate exception
  to the Desk-reads / Settings-writes split, because the journal is used at the desk.
- **`supabase/functions/fin-daily-signal/index.ts`** is the *only* place verdict logic
  lives. The frontend never computes the verdict — it only maps `verdict → color/label`
  (`VERDICT_META`) and derives *display-only* reads from the contract log via
  `cycleRead()` (feeds the cycle-position meter **and** the `TriggerBanner`). These mirror
  the edge function's contract-trigger dimension but never set the verdict.

**The verdict is a monotonic escalation**, computed in the edge function:
`HOLD(0) < WATCH(1) < ENTRY(2) < CAUTION(3)`. Each rule calls `escalate(to)` which only
ever raises the level, never lowers it. To add a new signal, push a `reason` and call
`escalate(...)` — do not reassign `verdict` directly. Priority is by design: CAUTION (bear
trigger) outranks everything.

**The core signal is manual.** The one input that actually decides the cycle — DDR5
contract-price direction — is logged by hand in `fin_contract_log` (Settings → "Log a
print"). The bear trigger fires when the **last two** prints are both `down`. Everything
else (prices, drawdowns, catalyst proximity, staleness) automates *around* that.

## Data model

All in `public`, all RLS-enabled:

- `fin_app_config` — hard single row (`check (id = 1)`); includes `journal`, `peaks`,
  `entry_levels`, `watch_levels`, `tickers`, `stale_days`.
- `fin_contract_log` — hand-logged DDR5 contract prints (`direction` = `up|flat|down`).
- `fin_catalysts` — upcoming events; user-editable `note`, distinct from pre-written `detail`.
- `fin_snapshots` — one row per `snapshot_date`; written only by the edge function. Carries
  `intel` (advisory DDR5 read) and `news` (the News tab's 10-item reading list — inert).

**RLS here is deliberately permissive and differs from `lazada-monitor/`.** That app is
owner-scoped (`user_id = auth.uid()`); this one has no auth at all — the anon role reads
everything and writes `fin_app_config` / `fin_contract_log` / `fin_catalysts`. That is only
safe because the deployed URL is kept private. **Don't copy this pattern into a new app,
and don't "align" it with the lzd_ pattern without adding Supabase Auth first.** Before
exposing this app publicly, switch to Supabase Auth and scope policies to a uid.

- The **anon key is public by design** (it ships in the frontend bundle). RLS is the only guard.
- **`fin_snapshots` has no anon write policy** — written exclusively by the edge function
  via the service-role key (which bypasses RLS). Do not add an anon insert policy.
- **Never** put the service-role key in a `VITE_*` var or anywhere the frontend can reach it.

## Migrations — 0001–0004 intentionally use the OLD table names

`supabase/migrations/` is an append-only ledger of what was actually applied, in order:

- `0001_init.sql` — tables + seed + RLS *(old names)*
- `0002_journal_and_notes.sql` — `app_config.journal`, `catalysts.note` *(old names)*
- `0003_daily_cron.sql` — `pg_cron`/`pg_net` + the daily job *(old `daily-signal` fn)*
- `0004_snapshot_intel.sql` — `snapshots.intel` *(old names)*
- `0005_fin_prefix.sql` — **the rename to `fin_*`**
- `0006_fin_daily_signal_cron.sql` — repoints cron at `fin-daily-signal`
- `0007_fin_snapshot_news.sql` — `fin_snapshots.news` (the News tab's reading list)

Do **not** retro-edit 0001–0004 to the new names: 0002 alters a table 0001 created, so
rewriting one without the others breaks replay. Replaying `0001 → 0007` on a fresh DB
yields the correct `fin_` shape. New migrations start at `0008_`.

**Migrations must be applied to the live project** — editing the `.sql` file alone changes
nothing deployed.

## Secrets

- `FINNHUB_API_KEY` — Supabase **edge function secret** (set and working; all four tickers
  resolve on the Finnhub free tier). `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
  auto-injected into the function.
- Note this app does **not** use the Vault + `lzd_get_secrets()` RPC pattern that
  `lazada-monitor/` uses — it has exactly one secret and reads it from `Deno.env`. Don't
  reach for `lzd_get_secrets()` here; that RPC is the other app's.
- **Frontend env** (`.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  Vite **inlines these at build time** — rebuild after any `.env` change. `.env.example`
  documents the shape; both values are public (the anon JWT is also visible in `0003`).

## UI: one design system across All-In-One

Both apps must read as one product. The house style is **light SaaS**: `bg-slate-50` page,
white `rounded-xl` cards with `border-slate-200`, **dark `slate-900` sidebar**, **indigo
primary**, stat-card row on top, `divide-y` lists/tables inside cards.

- **`components/ui.jsx` is a deliberate mirror of `lazada-monitor/web/src/components/ui.tsx`**
  (Button, Input, Select, Textarea, Card, CardHeader, StatusBadge, StatCard, Modal, Switch,
  Spinner, EmptyState, DataRow, `cn`). Same class strings on purpose. If you change a shared
  primitive, check whether the sibling app needs the same change. Reuse these rather than
  ad-hoc markup.
- The two apps differ only where they must: this one is `.jsx` (the sibling is `.tsx`), has
  no auth (so the sidebar footer shows data sources, not an email + sign-out), and uses
  Outlet context instead of react-query.
- **The shell is responsive and both apps must stay in step.** Below `lg` the sidebar is an
  off-canvas drawer behind a hamburger; at `lg`+ it's static (`lg:ml-60`). `lg` is used
  *only* for shell structure — content grids stay on the house `sm:`/`xl:` pattern. Three
  things fail silently if you touch it: the header must stay **`z-20`** (aside 40 > backdrop
  30 > header 20 — a `z-30` header would paint over the backdrop and stay clickable);
  `NavLink` needs `onClick={() => setOpen(false)}` **as well as** the `pathname` effect
  (tapping the route you're already on doesn't change `pathname`); and it's `lg:ml-60`, not
  `ml-60`, or content sits inset 240px behind an off-canvas drawer.
- **Semantic colours are fixed** and shared with the sibling app's stock statuses:
  emerald = good/`up`/HOLD, amber = watch/WATCH, red = bad/`down`/CAUTION, indigo =
  primary/ENTRY, slate = unknown/`flat`. Drawdown ramps emerald → yellow → amber → red as it
  approaches the historical −40/−60% bottom zone.
- Prices, tickers and dates use `font-mono`; everything else `font-sans` (Inter).

## Local development

The app is at this folder's root (**not** in a `web/` subfolder — that's `lazada-monitor`'s
layout, don't assume it here).

```bash
cd financial-tracker
npm install
npm run dev      # http://localhost:5173 (reads .env)
npm run build    # production build to dist/
npm run preview  # serve the built bundle
```

There is **no test suite, linter, or CI**. `npm run build` (Vite + esbuild) is the only
automated correctness gate — treat a clean build as the bar before shipping frontend
changes.

## Deploying changes

- **Edge function**: deploy via the Supabase MCP `deploy_edge_function` (name
  `fin-daily-signal`, `verify_jwt: true`). There is no `supabase` CLI login here; the
  `supabase/functions/` tree is the source mirror, not an auto-deploy.
- **Schema**: DDL via MCP `apply_migration` (snake_case name); ad-hoc SQL via
  `execute_sql`. Run `get_advisors` after DDL. New DB functions need `set search_path = ''`.
- **Frontend**: `npm run build`, deploy `dist/` to any static host (Vercel). **Keep the SPA
  rewrite** in `vercel.json` (all routes → `/index.html`) — the app uses client-side
  routing, so `/settings` 404s on a static host without it.

## Housekeeping — two dead edge functions to delete by hand

The Supabase MCP has **no delete-function tool**, so these survived the rename and must be
removed from the Supabase dashboard manually:

- **`daily-signal`** — superseded by `fin-daily-signal`. Still ACTIVE, but nothing points
  at it and its code references the pre-rename table names, so it now errors if invoked.
- **`market-probe`** — a one-off host-reachability probe, never in this repo.

## Gotchas future devs will hit

- **Missing `.env` fails silently, not loudly.** `supabase.js` falls back to a placeholder
  URL so the app still mounts (shows the empty state) instead of white-screening on the
  `createClient` throw. Upside: no blank page. Downside: a misconfigured env looks like "no
  data" rather than an error — check the console warning and that the bundle embeds the
  real project URL.
- **verify_jwt + key type.** The function requires a valid JWT. `refreshNow()` sends the
  **legacy anon JWT** as `Bearer`, which passes. The modern publishable key
  (`sb_publishable_…`) is **not a JWT** and will fail function auth — if you migrate the
  client to it, either keep the anon JWT for `refreshNow()` or redeploy with
  `verify_jwt: false` + custom auth. (`lazada-monitor/` uses the publishable key; that's
  why it works there and would break here.)
- **Two price sources, and Yahoo is not optional.** Finnhub is primary; **Yahoo is fetched
  for every ticker** because it carries the 52-week high *and* `currency`, *and* is the price
  fallback. Finnhub's free tier is **US-only** — `/quote` returns `{c:0}` for the Korean
  listings, so `000660.KS` / `005930.KS` are priced entirely by Yahoo. `prices[t].source`
  records which one answered. If Yahoo ever dies, the Korean names go dark, not just stale.
- **Tickers are NOT editable in the UI.** Settings only edits entry/watch levels for the
  tickers already in `fin_app_config.tickers` (a `text[]`, *not* jsonb — `ARRAY[...]::text[]`).
  Adding or removing one is a SQL update. After changing it, **re-run the function** or the
  dashboard keeps rendering the previous snapshot's ticker set. Also prune the old symbol
  out of `peaks` — peaks are auto-tracked and otherwise linger forever.
- **Symbols that were tried and rejected (2026-07-15) — don't re-add without a live quote.**
  SK Hynix has **no working US symbol**: `HXSCL`, `HXSCY`, `SKHYF`, `HXSCF`, `SKHYY` return
  nothing on *either* source (thin unsponsored OTC ADR). Samsung's US ADR `SSNLF` resolves
  but is **stale garbage** — price == prevClose == 52w high, so it shows a permanent 0%
  drawdown. Working non-US alternates if ever needed: `HY9H.F` (SK Hynix, Frankfurt, EUR)
  and `SMSN.IL` (Samsung GDR, London, USD).
- **No FX conversion anywhere.** Each ticker is priced, levelled and displayed in its **own**
  listing currency; a KRW level only ever compares against a KRW price. `fmtMoney()` in
  `lib/signal.js` formats from `prices[t].currency` — never hardcode `$`, or a ₩2,082,000
  quote renders as "$2,082,000". Drawdown is a ratio, so it's currency-agnostic and safe.
- **`daysBetween(a, b) = floor((a-b)/DAY_MS)` — argument order carries the sign.**
  Staleness uses `(now, logged_at)` (positive = days old); catalyst proximity uses
  `(event_date, now)` (0–3 = upcoming). Get the order wrong and the rule silently never fires.
- **`fin_snapshots` upserts on `snapshot_date`** — re-running the function the same day
  overwrites that day's row (idempotent, intended).
- **`fin_app_config` is a hard single row.** Always `update … eq('id', 1)`; never insert.
- **Yahoo's `chartPreviousClose` is a trap — never use it for the day change.** It is the
  close *before the requested range*, so at `range=1y` it's the price a **year** ago: it
  reported SK Hynix at "+597% today" before this was caught. `yahooQuote()` uses
  `meta.regularMarketPreviousClose`, falling back to the second-to-last daily candle. The
  bug is invisible on the US names (Finnhub supplies `dp` there), so it only ever shows up
  on the Yahoo-priced ones.
- **Peaks are auto-tracked, not user-set.** Finnhub's free tier has **no** historical/52-week
  high (`/stock/metric` and `/stock/candle` are premium), so the peak comes from **Yahoo
  Finance** (`query1.finance.yahoo.com/v8/finance/chart/{sym}` → `meta.fiftyTwoWeekHigh`,
  free, no key). The function keeps it as a **monotonic high-water mark**:
  `peak = max(storedPeak, yahoo52wHigh, currentPrice)` — corrects the value, never drops
  below an older cycle top, ratchets on new highs. Yahoo's prices match the Finnhub feed
  exactly (verified), so mixing them is safe; if Yahoo fails it falls back to the stored
  peak. Settings shows peak **read-only** and never writes that column (only
  `entry_levels` / `watch_levels` are user-owned) — so no lost-update race.
- **`fin_contract_log.direction` is a CHECK constraint** (`'up' | 'flat' | 'down'`). New
  values need a migration, not just frontend changes.
- **StrictMode double-runs effects in dev**, so `loadAll()` fires twice on mount locally —
  harmless, but don't chase it as a bug.
- **DDR5 news crawl uses Bing News RSS, not Google.** Google News RSS returns **503** to
  the Supabase edge IP; Bing works. `fetchDdr5Intel()` is best-effort — on any failure it
  stores `{}` and the UI hides the panel. Direction inference is naive substring keyword
  scoring, tuned to avoid collisions (e.g. `incr[ease]`, `a[gain]st`); it's advisory, not
  authoritative. Reachability differs by host **and** by runtime — always probe from an
  edge function, not local curl (this is what the now-dead `market-probe` was for).
  Yahoo/Finnhub work from the edge; some hosts 429/503 the datacenter IP.
- **News: `News:Image` is `http://` — rewrite it or every thumbnail silently vanishes.**
  The app is served over https, so the browser blocks the raw URL as mixed content. Bing
  honours the `News:ImageSize` template exactly (`&w=640&h=360&c=14` → a real 640×360 JPEG,
  ~45KB, verified); 240×135 is 1x-DPR and mushy on a phone.
- **News: `&mkt=en-us` MUST stay pinned.** Unpinned, Bing geolocates by CALLER IP — from a
  codespace it returned `mkt=en-in` and Indian startup-funding stories, and this function
  runs on the Seoul edge. Pinned, the same query returns Samsung/Micron/SK Hynix.
  ⚠️ **`fetchDdr5Intel()` does NOT pin `mkt` today** — its advisory read is probably being
  computed from a non-US feed. Fixing it will shift `intel.read`, so it's a deliberate call.
- **News: dedupe on the extracted `url`, never on `<link>`.** `<link>` is a Bing redirect
  wrapper (`bing.com/news/apiclick.aspx?...&url=<encoded>`) carrying a **per-request `tid`**,
  so the same article from two queries looks like two URLs. `realUrl()` unwraps it — which
  also means cards link straight to the publisher, no Bing hop.
- **News: merge is round-robin across queries, not a flat recency sort.** A flat sort lets
  the freshest query flood the list — the first live run returned 4/10 Oregon funding
  stories from the broad query alone. Interleaving + a Jaccard title guard (≥0.5 collapses
  "Oregon lands $160M" / "Oregon secures $160M" into one) fixed it to a ~4/4/2 blend.
- **News: Bing thumbnails expire.** Old snapshots' images 404, so `News.jsx`'s `onError`
  placeholder is load-bearing — an `image == null` check alone would show broken glyphs.
- **News: never write `news: {}` on a failed fetch.** The upsert omits the key entirely
  (`...(news ? { news } : {})`) because PostgREST builds `ON CONFLICT DO UPDATE SET` from the
  keys present, so an absent key preserves the stored blob (verified live, both directions).
  Mirroring `intel`'s `?? {}` would let one failed "Refresh now" blank the whole tab until
  the next day's cron.
- **Keep files UTF-8.** The original sources arrived with mojibake (garbled em-dashes/
  arrows); the app uses real Unicode (`—`, `→`, `▲▼`, `×`, `≤`, `−`). Watch for stray
  non-ASCII sneaking into places like CSS hex values.

## Design principles (preserve these when changing behavior)

1. **Default to Hold; escalate only.** Any new feature should keep quiet days quiet. Don't
   add noise that fires on normal volatility.
2. **Pre-committed levels beat in-the-moment judgment.** Entry/watch levels are set sober in
   Settings so the daily verdict fires off them mechanically. Don't add flows that invite
   ad-hoc, emotional overrides.
3. **One verdict, one source of truth.** Verdict computation stays in the edge function. The
   frontend displays; it does not decide.
4. **Manual contract log is sacred.** It's the single highest-signal input. Don't bury it or
   try to auto-scrape it away — the hand-logging is intentional friction. There are two
   strictly-ranked tiers of automated news, and they must not blur:
   - **`intel` — advisory.** The crawled DDR5 read (Desk §03 + a logging *suggestion* in
     Settings) infers a direction via `dirOf()`. It never sets the verdict and never writes
     `fin_contract_log`. It assists logging; it doesn't replace it.
   - **`news` — fully inert.** The News tab is a reading list, one tier stricter. It carries
     **no `dir` field, no `dirOf()` call, and no `StatusBadge`** — and that absence is the
     point. `dirOf()` sits in the same file and reusing it is the natural move; it is the
     wrong one. Inference is what turns a reading list into a signal.
5. **It monitors, it does not predict.** Framing in copy and UI should never imply price
   forecasting.

## Conventions / invariants

- **`fin_` / `FIN_` / `fin-` prefix on everything.** (Restated because it's the big one.)
- Never touch `lzd_*` objects — they're the sibling app's.
- Verdict logic lives in the edge function, once. The frontend never decides.
- RLS stays on every table; `fin_snapshots` stays service-role-write-only.
- Reuse `components/ui.jsx` primitives; keep them in step with the sibling app so the two
  apps stay visually one product. No bespoke CSS files.
- `npm run build` clean before shipping frontend changes.
