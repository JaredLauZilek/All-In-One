-- ============================================================
--  0005 — Namespace this app's tables with the fin_ prefix
--
--  Context: this app moved out of the standalone "DRAM" repo and
--  into the All-In-One monorepo as financial-tracker/. It shares
--  the Supabase project with the Lazada restock monitor (lzd_*),
--  so every object this app owns is now prefixed fin_ / FIN_ /
--  fin- to make collisions impossible.
--
--  Policies, indexes, constraints and sequence ownership all
--  follow the table automatically on rename — nothing to re-create.
--  Applied live 2026-07-15 (MCP fin_prefix_financial_tracker_tables).
--
--  NOTE: 0001–0004 above intentionally still use the OLD names.
--  They are the historical ledger of what was actually applied, in
--  order; this migration is the rename that came after. Replaying
--  0001 -> 0005 on a fresh database produces the correct fin_ shape.
-- ============================================================

alter table public.app_config   rename to fin_app_config;
alter table public.contract_log rename to fin_contract_log;
alter table public.catalysts    rename to fin_catalysts;
alter table public.snapshots    rename to fin_snapshots;
