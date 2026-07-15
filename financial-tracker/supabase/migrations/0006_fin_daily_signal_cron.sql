-- ============================================================
--  0006 — Repoint the daily cron at the renamed edge function
--
--  Supersedes the job scheduled in 0003. The edge function was
--  redeployed as `fin-daily-signal` (was `daily-signal`) and the
--  cron job itself renamed to match the fin- namespace.
--
--  Same schedule: 23:00 UTC = 07:00 MYT, after the US close.
--  The Bearer token is the PUBLIC anon JWT (as in 0003, safe to
--  store here) — it only passes the function's verify_jwt gate;
--  the function itself writes via the service role.
--
--  Re-runnable: unschedules both the old and new job names first.
--  Applied live 2026-07-15 (MCP fin_daily_signal_cron_repoint).
-- ============================================================

select cron.unschedule(jobid) from cron.job where jobname in ('daily-memory-signal', 'fin-daily-signal');

select cron.schedule(
  'fin-daily-signal',
  '0 23 * * *',
  $job$
  select net.http_post(
    url     := 'https://vjqbircarzxcxrdzlyxj.supabase.co/functions/v1/fin-daily-signal',
    headers := '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqcWJpcmNhcnp4Y3hyZHpseXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDQ3MjUsImV4cCI6MjA5OTE4MDcyNX0.TnxX82YmAlbXMvr3Ll4r4UB7d4rs3fcxrb-ozGB3KKE","Content-Type":"application/json"}'::jsonb
  );
  $job$
);
