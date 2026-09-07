-- 0011 · Hevy exercise library cache (2026-09-07)
-- Hevy's GET /v1/exercise_templates maps every exercise to a primary muscle group
-- and secondary groups. tr-sync stores each logged exercise's template_id and
-- refreshes this catalog whenever it meets an id it doesn't know. The Overview tab
-- joins the two to count working sets per muscle group. Not user data → readable by
-- any authenticated user (single-user app); only edge functions write.
create table if not exists public.tr_hevy_exercises (
  template_id              text primary key,
  title                    text not null,
  type                     text,
  primary_muscle_group     text,
  secondary_muscle_groups  jsonb not null default '[]',
  equipment                text,
  is_custom                boolean not null default false,
  updated_at               timestamptz not null default now()
);
alter table public.tr_hevy_exercises enable row level security;
create policy "read hevy exercises" on public.tr_hevy_exercises
  for select to authenticated using (true);
comment on table public.tr_hevy_exercises is 'Hevy exercise_templates cache (muscle groups). Written by tr-sync only.';
