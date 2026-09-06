-- ============================================================
--  0006 (tr) — zone results move to real columns on tr_workouts
--  Applied live 2026-09-06.
--
--  Bug: tr-sync's activity upsert rewrites the data jsonb wholesale
--  every run, wiping the custom_hr_zone_* results written into it by
--  the re-bucketing pass — so the "already bucketed?" check never
--  matched and every sync refetched every HR stream. Dedicated columns
--  survive the upsert (omitted columns keep their values on conflict).
-- ============================================================

alter table public.tr_workouts
  add column if not exists hr_zone_secs jsonb,   -- seconds per zone (custom model)
  add column if not exists hr_zones     jsonb,   -- the ceilings used
  add column if not exists hr_zones_key text;    -- "<effective_from>:<ceilings>" version stamp

-- carry over results from the jsonb era
update public.tr_workouts set
  hr_zone_secs = data->'custom_hr_zone_secs',
  hr_zones     = data->'custom_hr_zones',
  hr_zones_key = data->>'custom_zones_key'
where data ? 'custom_zones_key' and hr_zones_key is null;
