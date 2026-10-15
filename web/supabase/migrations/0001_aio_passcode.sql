-- Suite-wide passcode login (replaces the email/password form, 2026-10-15).
-- Service-role only: RLS on, no policies — the browser can never read the hash.
-- Change the passcode:  update aio_private set passcode_hash = encode(sha256('NEW'::bytea),'hex'), fails = 0, locked_until = null where id = 1;
create table if not exists public.aio_private (
  id            int primary key check (id = 1),
  passcode_hash text not null,          -- sha256 hex of the passcode
  fails         int  not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.aio_private enable row level security;
insert into public.aio_private (id, passcode_hash)
values (1, encode(sha256('1003'::bytea), 'hex'))
on conflict (id) do update set passcode_hash = excluded.passcode_hash, fails = 0, locked_until = null, updated_at = now();
