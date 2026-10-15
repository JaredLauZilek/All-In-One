# CLAUDE.md — Job Search (jb)

Backend home of the **Job Search** mini-app — Jared's tracker for the resumes he sends
out and where each application stands. The frontend lives in the unified app at
`web/src/apps/jobs/` (Pipeline / Log under `/jobs`); this folder holds the migration
ledger. **Everything this app owns is prefixed `jb_`** (siblings: `fin_`, `evs_`,
`tr_` — never touch theirs). No edge functions, no secrets: the browser talks to the
two tables directly under owner RLS.

## What this is

- **`jb_applications`** — one row per application: company, role, location, posting
  `url`, `source` (LinkedIn / referral / …), `status`, `applied_on`, `resume_version` (column kept, field removed 2026-10-15 — the
  uploaded PDF's filename is the version now),
  `salary`, `notes` (`contact` / `next_action` / `next_action_on` exist in the table but
  were dropped from the UI 2026-10-15 — Jared didn't want them),
  and (0002) **`resume_path` / `resume_name`** — the PDF actually sent, stored in the
  PRIVATE Storage bucket `jb-resumes` at `<uid>/<application id>/<ts>-<name>` (10 MB,
  PDF only; owner-only storage policies keyed on the first folder = `auth.uid()`).
  Plus (0003) **`cover_path` / `cover_name`** for the cover letter, same bucket. The
  modal uploads on Save, opens files via 1-hour signed URLs, and replace/remove take
  effect on Save. **A duplicate shares its source's file objects** (same path, no
  copy — Jared's choice 2026-10-15), so storage objects are only deleted by
  `releaseObject()` once NO application references the path (resume or cover);
  deleting an application releases its files the same way.
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
  a 5-column board (scrolls sideways on phones) and a Closed list. Click a card → modal.
- **Log** (`/jobs/log`): table with search + status filter and CSV export.
- **`ApplicationModal.tsx`**: add + edit + timeline + delete + **Duplicate** (2026-10-15:
  a copy icon on each card/row and a button in the modal open a NEW application
  pre-filled from `duplicateTemplate()` — company, role, location, link, source,
  salary, notes; status "applied" today; no resume file, no timeline — edit, then Add).
  Shared by both pages.
  Invalidates `jb-apps` and the Home tile's `home-status`.

## Deploying

- Schema: MCP `apply_migration`; mirror into `supabase/migrations/` (0001–0003 applied
  live 2026-10-15). Next migration: `0004_`.
- Frontend: push to main (single Vercel deploy — see `web/CLAUDE.md`).
