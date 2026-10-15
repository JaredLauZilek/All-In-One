# CLAUDE.md — Job Search (jb)

Backend home of the **Job Search** mini-app — Jared's tracker for the resumes he sends
out and where each application stands. The frontend lives in the unified app at
`web/src/apps/jobs/` (Pipeline / Log under `/jobs`); this folder holds the migration
ledger. **Everything this app owns is prefixed `jb_`** (siblings: `fin_`, `evs_`,
`tr_` — never touch theirs). No edge functions, no secrets: the browser talks to the
two tables directly under owner RLS.

## What this is

- **`jb_applications`** — one row per application: company, role, location, posting
  `url`, `source` (LinkedIn / referral / …), `status`, `applied_on`, `resume_version`
  (which tailored resume went out — pairs with the resume-builder skill's naming),
  `salary`, `contact`, `next_action` + `next_action_on` (follow-up reminder), `notes`.
- **`jb_events`** — the timeline per application: `kind` ∈ applied / email / call /
  interview / assessment / offer / rejection / followup / note, `happened_on`, notes.
  **A status change logs itself** (applied → "Applied", screening → "Call", interview →
  "Interview", offer → "Offer", rejected → "Rejection", anything else → a note
  "Status → X"), so the history writes itself; anything else is logged by hand.
- **Statuses** (`web/src/apps/jobs/lib.ts` `STATUS`): pipeline = saved → applied →
  screening → interview → offer; closed = rejected / withdrawn / ghosted. "Active" =
  open statuses minus saved.

## Pages (`web/src/apps/jobs/`)

- **Pipeline** (`/jobs`): stat cards (Active · Sent this month · Interviewing · Offers ·
  Response rate = anything past "applied", rejections included, over everything sent),
  an overdue-follow-ups banner (`next_action_on` < today on an open application),
  a 5-column board (scrolls sideways on phones) and a Closed list. Click a card → modal.
- **Log** (`/jobs/log`): table with search + status filter and CSV export.
- **`ApplicationModal.tsx`**: add + edit + timeline + delete, shared by both pages.
  Invalidates `jb-apps` and the Home tile's `home-status`.

## Deploying

- Schema: MCP `apply_migration`; mirror into `supabase/migrations/` (0001 applied live
  2026-10-15). Next migration: `0002_`.
- Frontend: push to main (single Vercel deploy — see `web/CLAUDE.md`).
