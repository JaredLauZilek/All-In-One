-- 0003 (jb) · cover-letter PDF per application (2026-10-15). Applied live 2026-10-15.
-- Same private bucket (jb-resumes) and policies as the resume. Several rows MAY point
-- at the same object (a duplicate shares its source's files instead of copying them),
-- so the app only deletes an object once no row references it.
alter table public.jb_applications
  add column if not exists cover_path text,
  add column if not exists cover_name text;
