# Financial Tracker

A daily check-in cockpit for the memory-stock cycle (MU, SNDK, WDC, DRAM). A Supabase cron
job pulls Finnhub prices once a day, reads the rules you set, computes ONE verdict, and a
React app shows it. Design goal: the default state is **Hold** — it only escalates when a
price level you pre-set is crossed or the DDR5 contract trigger fires. On most days it
should tell you to do nothing, and that's the point.

**This is a monitoring tool, not a "trade today" oracle.** The one signal that actually
moves the cycle — DDR5 contract-price direction — is monthly and logged by hand. Everything
else is automated around it.

One of two apps in the All-In-One monorepo (alongside `lazada-monitor/`). They share a
Supabase project; this app owns everything prefixed `fin_`. See `CLAUDE.md` for the
architecture, conventions, and gotchas.

## The verdict (highest firing condition wins)

| State | Fires when | Colour |
|-------|-----------|--------|
| **CAUTION** | Last two DDR5 contract prints are both `down` (bear trigger) | red |
| **ENTRY** | A stock reached the entry price you pre-set (your buy zone) | indigo |
| **WATCH** | A stock neared your watch price, a catalyst is within 3 days, or the contract log went stale | amber |
| **HOLD** | Nothing changed | emerald |

## Run it locally

```bash
cd financial-tracker
npm install
npm run dev      # http://localhost:5173
```

`.env` is gitignored and already present in this workspace. To recreate it:

```bash
cp .env.example .env   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
```

Use the **legacy anon JWT**, not the `sb_publishable_…` key — the edge function runs with
`verify_jwt: true` and the publishable key is not a JWT, so "Refresh now" would 401. Both
values are public by design (they ship in the bundle).

`npm run build` is the only automated correctness gate — there is no test suite or linter.

## Deploy

- **Frontend**: `npm run build`, deploy `dist/` (Vercel config is in `vercel.json`; keep the
  SPA rewrite or `/settings` 404s).
- **Edge function + schema**: via the Supabase MCP (`deploy_edge_function`,
  `apply_migration`). There is no `supabase` CLI login in this workspace — the
  `supabase/` tree is a source mirror, not an auto-deploy.

## Daily loop

1. Open the Desk, read the one verdict line. **Hold** → close it. That's the tool working.
2. Once a month when TrendForce/DRAMeXchange publishes, log the contract-price direction
   (Up/Flat/Down) in Settings. The only manual input — and the one that actually decides
   the cycle. The auto market-read from news is a *hint*, not the print.
3. Tune your entry/watch levels in Settings. Set them sober, in advance; the verdict fires
   off them so in-the-moment emotion doesn't get a vote. Peak is auto-tracked — you don't
   set it.

"Refresh now" (header, either page) runs the edge function on demand instead of waiting for
the 23:00 UTC cron.

## Security

Single-user personal app. RLS is on with **permissive anon policies** (read all + log prints
+ edit levels). Keep the deployed URL private, or add Supabase Auth and scope policies to a
uid before exposing it. `fin_snapshots` is service-role-write-only. The Finnhub key is an
edge secret and never touches the frontend.

## Costs

Supabase + Finnhub free tiers cover this: one daily run is ~5 API calls, far under
Finnhub's 60/min free limit. Yahoo (52-week highs) and Bing News RSS need no key.
