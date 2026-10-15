-- 0002 (jb) · resume PDF per application (2026-10-15). Applied live 2026-10-15.
-- Private Storage bucket jb-resumes; objects live at <auth.uid()>/<application_id>/<file>.
-- The row keeps the object path + original filename; the app opens it via a signed URL.
alter table public.jb_applications
  add column if not exists resume_path text,
  add column if not exists resume_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jb-resumes', 'jb-resumes', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- owner-only access: the first folder of the object name must be the caller's uid
create policy "jb resumes owner select" on storage.objects for select to authenticated
  using (bucket_id = 'jb-resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "jb resumes owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'jb-resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "jb resumes owner update" on storage.objects for update to authenticated
  using (bucket_id = 'jb-resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "jb resumes owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'jb-resumes' and (storage.foldername(name))[1] = auth.uid()::text);
