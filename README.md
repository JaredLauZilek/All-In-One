# All-In-One

Jared's personal tool suite — one repo, **one deployable app**, one login.

```
All-In-One/
├── web/                  ← THE frontend (Vite + React + TS). Home launcher at /,
│                            Financial Desk at /fin, Earnings Vol Scanner at
│                            /evs, Infrastructure hub at /infra. See web/CLAUDE.md.
├── financial-tracker/    ← Financial Desk BACKEND: fin-daily-signal edge fn +
│                            migration ledger. See its CLAUDE.md.
├── evs-scanner/          ← Earnings Vol Scanner BACKEND: evs-scan edge fn +
│                            migration ledger. See its CLAUDE.md; strategy in
│                            docs/earnings-volatility-strategy-guide.md.
├── vercel.json           ← single Vercel deploy config (builds web/, SPA rewrite)
└── package.json          ← convenience scripts (npm run dev/build proxy into web/)
```

## Day to day

- **Use it**: open the deployed Vercel URL, sign in, pick a tool from the Home screen.
- **Change frontend**: edit `web/`, `npm run build` clean, push to `main` — Vercel
  redeploys everything together.
- **Change backends**: edge functions/schema via Supabase MCP.

## One-time Vercel setup (after the 2026-08-17 merge)

1. Vercel → New Project → import `JaredLauZilek/All-In-One`, keep **root** as the
   project root (the root `vercel.json` does the rest). No env vars needed — `web/.env`
   is committed (all values public by design).
2. Delete the two old per-app Vercel projects so only this one serves traffic.

Shared Supabase project **DRAM** (`vjqbircarzxcxrdzlyxj`) hosts both tools' backends —
`fin_*` objects belong to financial-tracker, `evs_*` to evs-scanner. Never cross the
prefixes. (The `lzd_*` Restock Monitor was removed 2026-08-29 — `docs/lzd-teardown.sql`.)
The Infrastructure page in the app links every dashboard (Supabase, Vercel, Finnhub,
GitHub) with live health and monthly cost.
