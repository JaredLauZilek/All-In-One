-- 0007 · user-editable workout title (2026-09-07)
-- tr-sync rewrites `name` from the source (intervals.icu / Hevy) on every upsert, so a
-- rename made in the app must live in its own column that the sync payload never
-- includes. The UI shows custom_name ?? name; NULL = "use the source title".
alter table public.tr_workouts add column if not exists custom_name text;
comment on column public.tr_workouts.custom_name is
  'App-side rename (e.g. "Interval run", "Tempo"). Never written by tr-sync; NULL = source name.';
