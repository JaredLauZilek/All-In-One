-- ============================================================
--  0001 (jb) — Job Search tracker (2026-10-15). Applied live 2026-10-15.
--  Everything this mini-app owns is prefixed jb_. Owner-scoped RLS;
--  user_id defaults to auth.uid() so the browser inserts without it.
-- ============================================================
create table if not exists public.jb_applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company         text not null,
  role            text not null,
  location        text,
  url             text,                    -- the posting / portal link
  source          text,                    -- LinkedIn · referral · company site · recruiter · …
  status          text not null default 'applied'
                  check (status in ('saved','applied','screening','interview','offer','rejected','withdrawn','ghosted')),
  applied_on      date,
  resume_version  text,                    -- which tailored resume went out
  salary          text,
  contact         text,                    -- recruiter / hiring manager
  next_action     text,
  next_action_on  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jb_applications_user_status on public.jb_applications (user_id, status, applied_on desc);

create table if not exists public.jb_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id  uuid not null references public.jb_applications (id) on delete cascade,
  kind            text not null
                  check (kind in ('applied','email','call','interview','assessment','offer','rejection','followup','note')),
  happened_on     date not null default current_date,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists jb_events_app on public.jb_events (application_id, happened_on desc);

alter table public.jb_applications enable row level security;
alter table public.jb_events enable row level security;
create policy "owner rw jb_applications" on public.jb_applications
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner rw jb_events" on public.jb_events
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.jb_applications is 'Job Search tracker: one row per application (jb_ mini-app).';
comment on table public.jb_events is 'Job Search tracker: timeline events per application.';
