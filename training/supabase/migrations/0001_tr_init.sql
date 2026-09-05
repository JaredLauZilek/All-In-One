-- ============================================================
--  0001 (tr) — Training mini-app schema
--  New mini-app namespace: everything prefixed tr_ / TR_ / tr-
--  (siblings: fin_ = financial-tracker, evs_ = evs-scanner)
--
--  Endurance + Hyrox training hub: races, generated weekly plans,
--  ingested workouts (Strava/Hevy), settings, provider tokens and
--  the Telegram conversation log.
-- ============================================================

-- Races / competitions the plans aim at.
create table if not exists public.tr_races (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  race_type   text not null check (race_type in
                ('hyrox','half_marathon','marathon','half_ironman','ironman','other')),
  race_date   date,                          -- null = signed intent, date TBC
  location    text,
  priority    text not null default 'A' check (priority in ('A','B','C')),
  status      text not null default 'upcoming' check (status in ('upcoming','done','cancelled')),
  result      text,                          -- finish time / placing, free text
  notes       text,
  created_at  timestamptz not null default now()
);

-- One row per generated training week (volume targets + block label).
create table if not exists public.tr_plan_weeks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  race_id         uuid references public.tr_races (id) on delete set null,
  week_start      date not null,             -- always a Monday
  block           text not null check (block in ('base','build','peak','taper','deload','race','recovery')),
  focus           text,                      -- one-line coaching focus for the week
  planned_km      numeric,                   -- run volume target
  planned_minutes int,                       -- total training time target
  generated_by    text not null default 'rules',   -- 'rules' | 'rules+claude'
  notes           text,
  created_at      timestamptz not null default now(),
  unique (user_id, week_start)
);

-- Individual planned sessions (the things that land in Google Calendar).
create table if not exists public.tr_planned_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  race_id          uuid references public.tr_races (id) on delete set null,
  session_date     date not null,
  sport            text not null check (sport in
                     ('run','ride','swim','strength','hyrox','brick','mobility','rest','other')),
  title            text not null,
  detail           text,                     -- the actual prescription ("6×800m @ 5K pace…")
  planned_minutes  int,
  planned_km       numeric,
  intensity        text check (intensity in ('easy','steady','tempo','intervals','race')),
  status           text not null default 'planned'
                     check (status in ('planned','done','skipped','moved')),
  matched_workout_id uuid,                   -- set by tr-sync when an actual workout matches
  gcal_event_id    text,                     -- set when pushed to Google Calendar
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists tr_planned_sessions_user_date_idx
  on public.tr_planned_sessions (user_id, session_date);

-- Actual workouts ingested from Strava / Hevy (or logged by hand via the bot).
create table if not exists public.tr_workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  source       text not null check (source in ('strava','hevy','manual')),
  external_id  text,                         -- provider id, for idempotent upserts
  sport        text not null,
  name         text,
  started_at   timestamptz not null,
  duration_min numeric,
  distance_km  numeric,
  avg_hr       numeric,
  elev_m       numeric,
  data         jsonb not null default '{}',  -- raw summary (Hevy: full exercises/sets)
  created_at   timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index if not exists tr_workouts_user_time_idx
  on public.tr_workouts (user_id, started_at desc);

-- Per-user app settings + integration bits that are fine for the owner to read.
create table if not exists public.tr_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  telegram_chat_id text,                     -- linked via /link <pairing_code> in the bot
  pairing_code     text not null default substr(md5(gen_random_uuid()::text), 1, 8),
  hevy_api_key     text,                     -- Hevy Pro API key (owner-visible, RLS-guarded)
  weekly_hours     numeric not null default 8,
  days_per_week    int not null default 6,
  long_run_day     text not null default 'saturday',
  session_time     text not null default '06:30',  -- default calendar slot, MYT
  prefs            jsonb not null default '{}',
  last_synced_at   timestamptz,
  updated_at       timestamptz not null default now()
);

-- OAuth tokens (Strava). RLS is ON with NO policies: the browser can never read
-- this table — only edge functions (service role bypasses RLS) touch it.
create table if not exists public.tr_tokens (
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null check (provider in ('strava','google')),
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  meta          jsonb not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

-- Telegram conversation log — short-term memory for the bot's Claude calls
-- (and an audit of what the bot changed). Written by the webhook (service role).
create table if not exists public.tr_chat_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists tr_chat_log_user_time_idx
  on public.tr_chat_log (user_id, created_at desc);

alter table public.tr_races            enable row level security;
alter table public.tr_plan_weeks       enable row level security;
alter table public.tr_planned_sessions enable row level security;
alter table public.tr_workouts         enable row level security;
alter table public.tr_settings         enable row level security;
alter table public.tr_tokens           enable row level security;   -- no policies: edge-only
alter table public.tr_chat_log         enable row level security;

create policy "owner rw races" on public.tr_races
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw plan weeks" on public.tr_plan_weeks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw planned sessions" on public.tr_planned_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw workouts" on public.tr_workouts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw settings" on public.tr_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- chat log: owner may read (dashboard could show it); only edge functions write.
create policy "owner read chat log" on public.tr_chat_log
  for select to authenticated using (user_id = auth.uid());
