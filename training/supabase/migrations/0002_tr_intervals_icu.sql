-- ============================================================
--  0002 (tr) — intervals.icu as a workout source
--  Applied live 2026-09-06.
--
--  Strava gated its API behind a paid Strava subscription, so the
--  free activity pipe is now Garmin → intervals.icu → tr-sync.
--  Credentials are an athlete id + API key (owner-visible in
--  tr_settings, same treatment as the Hevy key). The Strava OAuth
--  path stays in place, dormant, in case Jared ever subscribes.
-- ============================================================

alter table public.tr_workouts drop constraint if exists tr_workouts_source_check;
alter table public.tr_workouts add constraint tr_workouts_source_check
  check (source in ('strava', 'hevy', 'manual', 'intervals'));

alter table public.tr_settings
  add column if not exists intervals_athlete_id text,
  add column if not exists intervals_api_key text;
