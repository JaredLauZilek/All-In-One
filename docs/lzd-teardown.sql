-- ============================================================
--  Restock Monitor (lzd_) teardown — written 2026-08-29
--
--  Removes everything the deleted lazada-monitor app owned in the
--  shared DRAM Supabase project. DESTRUCTIVE: drops all product /
--  check / notification history permanently.
--
--  Run in the Supabase SQL editor (or via MCP execute_sql) once.
--  NOT in a migration ledger: the app's own ledger folder was
--  deleted with the app; this file is the record of the teardown.
--
--  After running, two things are dashboard-only:
--   1. Delete the edge function `lzd-telegram-webhook`
--      (Dashboard → Edge Functions — the MCP has no delete tool).
--   2. Vault: confirm no LZD_* entries remain (step below removes
--      them, but verify under Project Settings → Vault).
--  Already done outside the DB: Telegram webhook deleted
--  (2026-08-29); Fly app `lazada-monitor-worker` to be destroyed
--  by Jared (account jlau901@gmail.com, org "personal").
-- ============================================================

-- 1. Cron jobs (ignore errors if a name doesn't exist)
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname like 'lzd%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

-- 2. RPC + tables (captures table exists since the network-inspector feature)
drop function if exists public.lzd_get_secrets();
drop table if exists public.lzd_captures;
drop table if exists public.lzd_checks;
drop table if exists public.lzd_notifications;
drop table if exists public.lzd_settings;
drop table if exists public.lzd_worker_state;
drop table if exists public.lzd_products;

-- 3. Vault secrets
delete from vault.secrets where name like 'LZD_%';

-- 4. Verify: all three should return zero rows
select tablename from pg_tables where tablename like 'lzd%';
select jobname from cron.job where jobname like 'lzd%';
select name from vault.secrets where name like 'LZD_%';
