-- ============================================================
--  0009 — revoke client EXECUTE on public.rls_auto_enable()
--
--  The security advisors flagged this SECURITY DEFINER function
--  (a platform helper that auto-enables RLS on new public tables
--  via event trigger) as callable by anon/authenticated through
--  /rest/v1/rpc. Nothing client-side ever calls it. The event
--  trigger keeps working — DDL applied via the dashboard/MCP
--  runs as postgres, which is unaffected by these revokes.
--
--  Applied live 2026-08-17 (MCP lockdown_rls_auto_enable).
--  Not a fin_ object, but this ledger is where schema history
--  lives; the function is project-wide, owned by neither app.
-- ============================================================

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
