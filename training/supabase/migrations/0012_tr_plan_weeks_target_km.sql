-- 0012 · manual weekly run-km target (2026-09-17)
-- The Overview's "Run km (actual/plan)" denominator. NULL = fall back to the sum of
-- planned_km on the week's run sessions. Kept apart from planned_km, which still
-- holds the retired rule engine's number. Owner RLS ("owner rw plan weeks") lets the
-- browser upsert it directly; user_id defaults to auth.uid().
alter table public.tr_plan_weeks add column if not exists target_km numeric;
comment on column public.tr_plan_weeks.target_km is 'Jared''s manual weekly run-km target (Overview stat); NULL = derive from planned run sessions.';
