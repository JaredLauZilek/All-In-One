-- ============================================================
--  0001 (evs) — Earnings Volatility Scanner schema
--  Applied live 2026-08-26 (MCP evs_init).
--  New mini-app namespace: everything prefixed evs_ / EVS_ / evs-
--  (sibling namespaces: fin_ = financial-tracker, lzd_ = lazada-monitor)
-- ============================================================

-- Per-user scanner settings: portfolio + tunable strategy thresholds.
create table if not exists public.evs_settings (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  portfolio_value     numeric not null default 10000,
  kelly_fraction      numeric not null default 0.06,      -- 10% Kelly ~ 6% of portfolio per trade
  ts_slope_threshold  numeric not null default -0.00406,  -- pass if slope <= this
  volume_threshold    numeric not null default 1500000,   -- pass if 30d avg volume >= this
  iv_rv_threshold     numeric not null default 1.25,      -- pass if IV30/RV30 >= this
  updated_at          timestamptz not null default now()
);

-- Logged plays (calendar spreads). Filter values are frozen at entry so the
-- stats page can compare live results against the strategy's expected profile.
create table if not exists public.evs_trades (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker            text not null,
  earnings_date     date,
  verdict           text,
  structure         text not null default 'calendar',
  strike            numeric,
  front_expiry      date,
  back_expiry       date,
  debit             numeric,          -- per spread, at entry
  contracts         int,
  ts_slope          numeric,
  avg_volume_30d    numeric,
  iv_rv             numeric,
  implied_move_pct  numeric,
  status            text not null default 'open' check (status in ('open','closed')),
  exit_debit        numeric,          -- per spread, at exit
  pnl               numeric,
  pnl_pct           numeric,
  note              text,
  entered_at        timestamptz not null default now(),
  closed_at         timestamptz
);

create index if not exists evs_trades_user_time_idx on public.evs_trades (user_id, entered_at desc);

alter table public.evs_settings enable row level security;
alter table public.evs_trades   enable row level security;

-- Owner-scoped like lzd_: authenticated users touch only their own rows.
create policy "owner rw settings" on public.evs_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw trades" on public.evs_trades
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
