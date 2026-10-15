-- 0013 · hide a workout in the app (2026-10-15)
-- A plain DELETE would not stick: tr-sync re-upserts the whole 45-day window
-- from intervals.icu / Hevy on every run. So "delete" in the app = set hidden_at.
-- tr-sync's upsert payload never includes this column, so it survives every sync;
-- the frontend filters `hidden_at is null`. Nothing is written back to the sources.
alter table public.tr_workouts add column if not exists hidden_at timestamptz;
create index if not exists tr_workouts_visible on public.tr_workouts (user_id, started_at) where hidden_at is null;
comment on column public.tr_workouts.hidden_at is 'Hidden in the app by Jared (soft delete). Never written by tr-sync; NULL = visible.';
