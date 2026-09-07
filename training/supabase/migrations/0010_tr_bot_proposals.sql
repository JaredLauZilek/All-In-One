-- 0010 · Telegram bot proposals need Jared's OK before touching the plan (2026-09-07)
-- Claude's plan-editing actions are no longer applied on sight: they're parked here,
-- shown in Telegram with Apply / Discard buttons, and only applied on "apply".
create table if not exists public.tr_bot_proposals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  chat_id     text not null,
  summary     text not null,                 -- human-readable list of the proposed changes
  actions     jsonb not null,                -- the validated action list (tr_planned_sessions only)
  status      text not null default 'pending' check (status in ('pending','applied','discarded','expired')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists tr_bot_proposals_pending on public.tr_bot_proposals (user_id, created_at desc) where status = 'pending';
alter table public.tr_bot_proposals enable row level security;
-- Read-only from the app (owner); only edge functions (service role) write.
create policy "owner read proposals" on public.tr_bot_proposals
  for select to authenticated using (user_id = auth.uid());
comment on table public.tr_bot_proposals is 'Telegram bot: plan changes proposed by Claude, awaiting Apply/Discard.';
