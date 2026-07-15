-- ============================================================
--  0007 — Daily semiconductor news reading list on the snapshot
--
--  Additive. fin-daily-signal fills this each run from a 3-query
--  Bing News RSS merge (deduped, 10 most recent); the News tab
--  displays it. Lives on the snapshot because the data's useful
--  life is exactly one day: Bing's th?id=... thumbnails are
--  ephemeral CDN entries, so an archive table would rot into dead
--  image URLs within weeks.
--
--  INERT BY DESIGN. Unlike `intel` (0004) — which infers a
--  direction and drives a logging *suggestion* in Settings — this
--  blob has no direction inference and no consumer other than the
--  News tab. It never touches the verdict, the trigger, or
--  fin_contract_log. Keep it that way.
--
--  Applied live 2026-07-15 (MCP fin_snapshot_news).
-- ============================================================

alter table public.fin_snapshots
  add column if not exists news jsonb not null default '{}'::jsonb;
