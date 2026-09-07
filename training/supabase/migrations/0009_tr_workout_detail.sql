-- 0009 · per-workout detail cache (2026-09-07)
-- tr-activity fetches ONE run's streams (downsampled HR + pace) and device laps from
-- intervals.icu on first open and caches them here. Real column on purpose: tr-sync
-- rewrites `data` wholesale every run and never touches this.
alter table public.tr_workouts add column if not exists detail jsonb;
comment on column public.tr_workouts.detail is
  'tr-activity cache: {points:[{t,hr,pace,d}], laps:[{n,type,start,secs,m,avg_hr,max_hr,pace}], fetched_at}. Never written by tr-sync.';
