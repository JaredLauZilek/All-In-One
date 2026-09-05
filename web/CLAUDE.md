# CLAUDE.md — All-In-One web app (the single frontend)

Conventions and workflow for the unified frontend. Read before changing code. Keep this
file in sync when architecture, secrets, or deploy steps change.

## What this is

**The one deployable frontend for every tool in this repo.** One Vite + React + TS app,
one Vercel deploy, one login (Supabase Auth, single user jared@voltara.com.my). It merged
the two previously separate frontends on 2026-08-17:

- **Financial Desk** (`/fin`) — from `financial-tracker/` (backend still lives there)
- ~~Restock Monitor (`/lzd`)~~ — **removed 2026-08-29** along with the whole
  `lazada-monitor/` folder (Fly worker retired, lzd_ DB objects torn down — see
  `docs/lzd-teardown.sql`)
- **Earnings Vol Scanner** (`/evs`) — added 2026-08-26; backend in `evs-scanner/`
  (edge fn `evs-scan` does all the math — see that folder's CLAUDE.md)

plus two pages of its own: the **Home launcher** (`/`) and **Infrastructure** (`/infra`),
which lists every external service (Supabase, Vercel, Finnhub, GitHub)
with live health read straight from the DB.

Each tool's *backend* docs stay canonical in its own folder: read
`../financial-tracker/CLAUDE.md` for fin_ data-flow/verdict rules and
`../evs-scanner/CLAUDE.md` for the earnings-scanner model before touching those pages.

## Layout

```
web/
├── vercel.json is NOT here — the deploy config is /vercel.json at the REPO ROOT
├── .env               ← committed on purpose; all values are public (see Secrets)
└── src/
    ├── App.tsx        # auth gate → Login; router; react-query provider
    ├── components/
    │   ├── Layout.tsx # THE sidebar shell (grouped nav per tool) — single copy now
    │   └── ui.tsx     # design-system primitives — single copy now
    ├── lib/
    │   ├── supabase.ts   # ONE client (publishable key + auth) + refreshNow()
    │   └── finSignal.js  # fin display helpers (cycleRead, fmtMoney, …)
    ├── pages/         Home.tsx (launcher) · Infrastructure.tsx (ops hub) · Login.tsx
    └── apps/
        ├── fin/       FinShell.tsx + Desk/News/Settings (.jsx, ported as-is)
        └── evs/       Scanner/Trades/Settings (.tsx) + lib.ts
```

- **`apps/fin/*.jsx` are plain JSX** (ported verbatim from the old app; `allowJs` is on,
  `checkJs` off). New code should be `.tsx`. Don't convert them casually — they carry
  hard-won gotcha comments.
- **FinShell** owns the fin section: fetches the four `fin_` tables on entry, passes them
  via Outlet context, and **portals the "Refresh now" button into `#header-actions`**
  (a slot div in Layout's header). The evs pages self-fetch with react-query instead —
  the two data patterns are both intentional (polling-friendly vs once-a-day data).
- **Routing**: `/fin`, `/fin/news`, `/fin/settings`, `/evs`, `/evs/trades`,
  `/evs/settings`, `/infra`. Titles live in `Layout.tsx` `TITLES`;
  nav in `NAV_GROUPS`. A new tool = a folder under `apps/`, routes in `App.tsx`, a nav
  group in Layout, a tile in `Home.tsx`, and (if it uses services) entries in
  `Infrastructure.tsx` `SERVICES`.

## Auth — the whole app is behind one passwordless login

Everything (including the Financial Desk, which previously had no auth) sits behind the
Supabase Auth session. One client in `lib/supabase.ts` uses the **publishable key**; all
queries run as the `authenticated` role.

- **Login is dual-mode; password is the DEV default.** `Login.tsx` has both a password
  form (`signInWithPassword`) and the passwordless flow (`signInWithOtp` →
  `verifyOtp(type: "email")` — 6-digit code, or the magic link in the same email), with
  a toggle between them. `DEFAULT_MODE` at the top of the file is `"password"` while the
  app is undeployed (Jared's dev preference) — **flip it to `"otp"` at go-live**; that
  one constant is the whole switch. In the OTP flow, **`shouldCreateUser: false` is
  load-bearing**: it's what makes a stranger's email bounce ("That email doesn't have
  access") instead of minting an account. Keep **"Allow new users to sign up" OFF** in
  the Supabase dashboard too — the client flag only guards THIS app's calls, not the raw
  auth API. There is no change-password UI; passwords are
  managed in the Supabase dashboard (Auth → Users) if needed.
- Magic-link clicks redirect to the project's **Site URL** (Supabase dashboard → Auth →
  URL Configuration) — set it to the deployed Vercel URL or the link lands on the wrong
  host. The code path works regardless.
- The `fin_` RLS policies from 0001 had no `TO` clause → `public`, so fin pages work
  logged-in with no schema change — but the anon key alone also still works against
  those tables. **Migration `0008_fin_authenticated_rls.sql`** (in
  `financial-tracker/supabase/migrations/`) closes that: drops the anon policies and
  recreates them `TO authenticated` *pinned to the owner's email* via `fin_is_owner()`.
  No data change; cron/edge fn unaffected (service role bypasses RLS). If the login
  email ever changes, update `fin_is_owner()`.

## Secrets / env

`web/.env` is **committed**: URL, publishable key, and the legacy anon JWT are all public
by design (the anon JWT already sits in migration `0003`). Never put the service-role key
or any edge-function secret anywhere under `web/`. Vite inlines env at build time — rebuild
after changes.

**Two keys on purpose:** the client uses the publishable key, but `refreshNow()` sends
the **legacy anon JWT** as its Bearer — `fin-daily-signal` is deployed `verify_jwt: true`
and the publishable key is not a JWT. Don't "simplify" one away.

## UI: one design system, one copy

House style unchanged: `bg-slate-50` page, white `rounded-xl` cards + `border-slate-200`,
dark `slate-900` sidebar, indigo primary, stat-card rows, `divide-y` lists. `ui.tsx` and
`Layout.tsx` are now the **single copies** (the old mirror-by-hand pact between the two
apps is dead — edit here, everyone gets it). `StatusBadge` deliberately speaks every
tool's vocabulary (verdicts, print directions, scanner pass/fail) — same semantic colours.

Shell gotchas (unchanged, still load-bearing): header stays **`z-20`** (aside 40 >
backdrop 30 > header 20); NavLink needs `onClick={() => setOpen(false)}` **and** the
`pathname` effect; it's `lg:ml-60`, not `ml-60`. Wide tables scroll inside their card
(`overflow-x-auto` + `min-w-[…]`).

## Local development

```bash
cd web && npm install && npm run dev     # or `npm run dev` from the repo root
npm run build                            # tsc -b && vite build — the bar before shipping
```

No test suite/linter/CI; a clean `npm run build` is the correctness gate.
`vite.config.ts` keeps `server.host/allowedHosts: true` for Codespaces previews.

## Deploying

Push to `main` → Vercel builds via the **root** `/vercel.json`
(`npm --prefix web install/build`, output `web/dist`, SPA rewrite included — required,
client-side routing). One Vercel project for everything; if the two pre-merge Vercel
projects still exist, delete them so only this one serves traffic.

Backends deploy separately and unchanged: edge functions via Supabase MCP
`deploy_edge_function`, schema via `apply_migration`. See each tool's CLAUDE.md.
