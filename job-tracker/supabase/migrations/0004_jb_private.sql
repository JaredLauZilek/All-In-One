-- 0004 (jb) · private config for the MCP connector (2026-10-15). Applied live 2026-10-15.
-- One row. RLS ON with NO policies → only edge functions (service role) can read it;
-- the browser never can. Holds the key claude.ai's custom connector presents as
-- ?key=… to jb-mcp. Rotate: update jb_private set mcp_key = '<new>' where id = 1.
create table if not exists public.jb_private (
  id       integer primary key check (id = 1),
  mcp_key  text not null,
  updated_at timestamptz not null default now()
);
alter table public.jb_private enable row level security;
-- (the key value is inserted out-of-band, never committed)
