-- ============================================================
--  0003 (tr) — daily wellness from intervals.icu (Garmin stream)
--  Applied live 2026-09-06.
--
--  intervals.icu receives Garmin's wellness data (resting HR, HRV,
--  sleep, weight) alongside activities — recovering the recovery
--  signal we thought required Apple Health. tr-sync upserts one row
--  per day; tr-plan-week and the Telegram bot feed it to Claude so
--  weekly plans and chat advice become recovery-aware.
-- ============================================================

create table if not exists public.tr_wellness (
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,
  resting_hr  numeric,
  hrv         numeric,          -- rMSSD as reported by Garmin via intervals.icu
  sleep_secs  numeric,
  sleep_score numeric,
  weight_kg   numeric,
  data        jsonb not null default '{}',   -- raw row (spO2, fatigue, soreness, …)
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.tr_wellness enable row level security;

create policy "owner rw wellness" on public.tr_wellness
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
