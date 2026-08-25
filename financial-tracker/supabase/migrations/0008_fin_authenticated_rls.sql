-- ============================================================
--  0008 — fin_ RLS: require a signed-in user (and the right one)
--
--  Context: the unified All-In-One app (web/) put the Financial
--  Desk behind Supabase Auth on 2026-08-17, so the option-B
--  hardening that 0001 deferred is now possible. The original
--  policies had no TO clause (→ public), meaning anyone holding
--  the public anon key could read and write these tables without
--  ever seeing the login screen. These replacements scope every
--  grant to the authenticated role AND pin it to the owner's
--  email, so even a stray signed-up account sees nothing.
--
--  No data is touched. The daily cron / fin-daily-signal writes
--  via the service role, which bypasses RLS — unaffected.
--
--  ⚠ If the login email ever changes, update fin_is_owner() to
--  match or the app goes read-nothing for the new account.
--
--  Written 2026-08-17. Apply via the Supabase SQL editor or MCP
--  apply_migration — editing this file alone changes nothing.
-- ============================================================

-- Single place the owner check lives (used by all five policies).
create or replace function public.fin_is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'jared@voltara.com.my'
$$;

drop policy "anon read config"    on public.fin_app_config;
drop policy "anon write config"   on public.fin_app_config;
drop policy "anon rw contract"    on public.fin_contract_log;
drop policy "anon rw catalysts"   on public.fin_catalysts;
drop policy "anon read snapshots" on public.fin_snapshots;

create policy "owner read config"    on public.fin_app_config   for select to authenticated using (public.fin_is_owner());
create policy "owner write config"   on public.fin_app_config   for update to authenticated using (public.fin_is_owner()) with check (public.fin_is_owner());
create policy "owner rw contract"    on public.fin_contract_log for all    to authenticated using (public.fin_is_owner()) with check (public.fin_is_owner());
create policy "owner rw catalysts"   on public.fin_catalysts    for all    to authenticated using (public.fin_is_owner()) with check (public.fin_is_owner());
create policy "owner read snapshots" on public.fin_snapshots    for select to authenticated using (public.fin_is_owner());
-- fin_snapshots still has NO insert/update policy for any client role —
-- written exclusively by the edge function via the service role.
