# CLAUDE.md — Earnings Vol Scanner (evs)

Backend home of the **evs** mini-app. The frontend lives in the unified app at
`web/src/apps/evs/` (Scanner / Trades / Settings under the `/evs` routes); this folder
holds the edge function and migration ledger. **Everything this app owns is prefixed
`evs_` / `EVS_` / `evs-`** (sibling: `fin_` financial-tracker —
never touch theirs).

## What this is

A screener for the "selling earnings volatility" strategy (long ATM calendar spreads
through earnings). Full strategy reference: `docs/earnings-volatility-strategy-guide.md`
at the repo root. You type a ticker; the app reports the next earnings date, computes
three filters, and issues RECOMMEND / CONSIDER / AVOID plus a sized calendar-spread
ticket. A trade log compares live results to the backtest profile (66% win rate, +7.3%
mean, sd 28%).

## Architecture

```
web /evs Scanner ── supabase.functions.invoke ──> edge fn evs-scan
                                                    ├─ Yahoo v7 options (cookie+crumb)
                                                    ├─ Yahoo v8 chart (history)
                                                    └─ all math + verdict, returns JSON
web /evs Trades / Settings ──> tables evs_trades / evs_settings (owner-scoped RLS)
```

- **`supabase/functions/evs-scan/index.ts`** is the only place the model lives: ATM-IV
  term structure (skips IVs ≤0.01 or ≥5), linear interpolation to 30/45 DTE, slope =
  `(IV45 − IVfront)/(45 − DTEfront)` with front = first expiry AFTER earnings,
  Yang-Zhang 30d realized vol (close-to-close fallback), verdict logic (slope fail ⇒
  AVOID always), calendar construction (tighter-spread side wins, back ≈ front+30d),
  sizing (`floor(portfolio × kelly / (debit × 100))`). Thresholds have defaults in the
  function; the client overrides them from `evs_settings` per request.
- **Yahoo needs the cookie+crumb dance** (`yahooSession()`): fetch fc.yahoo.com for a
  cookie, then `/v1/test/getcrumb`; every call retries crumbless. Verified working from
  the Supabase edge (Seoul) 2026-08-26. The data layer is deliberately swappable —
  replace `yahooGet`/`optionsUrl` to move to Polygon/ORATS.
- Deployed `verify_jwt: true` — the browser's session JWT (via `functions.invoke`)
  passes; the raw publishable key does not. CORS is handled in-function (OPTIONS).

## Data model (all RLS owner-scoped, `user_id = auth.uid()`)

- `evs_settings` — one row/user: `portfolio_value`, `kelly_fraction` (0.06 = 6%/trade ≈
  10% Kelly), and the three filter thresholds. Row is created lazily by the frontend.
- `evs_trades` — the log. Filter values frozen at entry; closing computes
  `pnl = (exit_debit − debit) × contracts × 100` and `pnl_pct` client-side.

## Deploying

- Edge function: Supabase MCP `deploy_edge_function` (name `evs-scan`,
  `verify_jwt: true`); `supabase/functions/` here is the source mirror.
- Schema: MCP `apply_migration`; mirror into `supabase/migrations/` (0001 applied live
  2026-08-26). Next migration: `0002_`.
- Frontend: push to main (single Vercel deploy — see `web/CLAUDE.md`).

## Gotchas

- **Front DTE ≥ 44 ⇒ slope is null ⇒ automatic fail/AVOID** with a warning — no
  near-dated expiry means no event premium to sell.
- Yahoo quotes go stale when the US market is closed; debit can come back ≤ 0 → the
  function warns instead of recommending garbage. Real entries happen ~15 min before the
  US close (≈ 3:45 AM MYT) when quotes are live.
- `earningsTimestampStart` is Yahoo's estimate and can shift; the function flags events
  outside a 21-day window as "preview, not a live setup".
- The strategy's caveats are baked into responses as `warnings[]` — keep them visible in
  any UI change; this tool screens, it does not advise.
