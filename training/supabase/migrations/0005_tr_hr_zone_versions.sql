-- ============================================================
--  0005 (tr) — dated HR-zone versions
--  Applied live 2026-09-06.
--
--  Zones change when Jared re-tests (lactate / VO2max), and history
--  must keep the zones that were TRUE AT THE TIME. So zones become a
--  version list: each row applies to activities dated on/after its
--  effective_from, until the next version; activities older than the
--  earliest version use the earliest one (pre-history is covered).
--  tr-sync picks the applicable version per activity and re-buckets
--  only what changed (data.custom_zones_key embeds the version date).
--  Replaces the single tr_settings.hr_zones column (0004).
-- ============================================================

create table if not exists public.tr_hr_zones (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  effective_from date not null,
  ceilings       jsonb not null,   -- ascending bpm ceilings, last = max HR
  note           text,             -- e.g. "Lactate test @ clinic"
  created_at     timestamptz not null default now(),
  unique (user_id, effective_from)
);

alter table public.tr_hr_zones enable row level security;
create policy "owner rw hr zones" on public.tr_hr_zones
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- carry the current single zone set over as the baseline version
insert into public.tr_hr_zones (user_id, effective_from, ceilings, note)
select user_id, date '2000-01-01', hr_zones,
       'Baseline — estimated from LTHR 173 / max 191 (pre-test)'
from public.tr_settings
where hr_zones is not null
on conflict (user_id, effective_from) do nothing;

alter table public.tr_settings drop column if exists hr_zones;
