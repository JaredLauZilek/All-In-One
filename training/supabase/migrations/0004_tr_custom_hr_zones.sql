-- ============================================================
--  0004 (tr) — user-defined HR zones
--  Applied live 2026-09-06.
--
--  Jared re-tests his lactate threshold / VO2max periodically and
--  wants to own the zone ceilings instead of trusting intervals.icu's
--  estimated model. hr_zones = jsonb array of ascending bpm ceilings
--  (last = max HR), edited in Training → Settings. NULL = fall back
--  to the intervals.icu model. tr-sync re-buckets each activity's raw
--  HR stream against these into data.custom_hr_zone_secs.
-- ============================================================

alter table public.tr_settings
  add column if not exists hr_zones jsonb;
