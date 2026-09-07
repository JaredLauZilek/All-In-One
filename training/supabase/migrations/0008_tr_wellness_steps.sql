-- 0008 · daily steps (2026-09-07)
-- intervals.icu's wellness row carries Garmin's daily step total (`steps`); the
-- Activities tab shows it in each day's wellness strip alongside sleep / RHR / HRV.
alter table public.tr_wellness add column if not exists steps integer;
comment on column public.tr_wellness.steps is 'Garmin daily step total via intervals.icu wellness.steps';
