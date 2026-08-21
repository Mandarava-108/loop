-- Owner delete rights, for removing participant sessions from the dashboard.
-- (responses already had an owner delete policy from the initial schema.)
-- Deleting a session cascades its recording_chunks and screener_answers rows.

drop policy if exists "owners delete sessions" on public.sessions;
create policy "owners delete sessions"
  on public.sessions
  for delete
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

drop policy if exists "owners delete recordings" on storage.objects;
create policy "owners delete recordings"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'recordings'
    and exists (
      select 1 from public.tests t
      where t.id = (storage.foldername(name))[1]
        and t.owner_id = auth.uid()
    )
  );
