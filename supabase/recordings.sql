-- Session recording (chunked): sessions + recording_chunks tables + storage policies.
-- PREREQUISITE: create a PRIVATE storage bucket named  recordings  first
-- (Dashboard -> Storage -> New bucket), then run this file in the SQL Editor.
--
-- Safe to re-run (and safe if you ran an earlier version of this file):
-- it drops and recreates only the recording tables/policies.

drop policy if exists "participants upload recordings" on storage.objects;
drop policy if exists "owners read recordings" on storage.objects;
drop table if exists public.recording_chunks;
drop table if exists public.sessions;

-- ---------- sessions ----------
-- One row per participant visit, created once at the consent screen.
-- responses.session_id refers to sessions.id, but without a foreign key:
-- sessions from before this feature don't have rows here.

create table public.sessions (
  id             uuid primary key,
  test_id        text not null references public.tests (id) on delete cascade,
  consent_status text not null check (
    consent_status in ('granted', 'declined', 'permission_denied', 'unsupported')
  ),
  consent_at     timestamptz not null,
  -- 'screen' = getDisplayMedia video (current), 'rrweb' = DOM capture (later).
  -- Null when this session has no recording.
  recording_type text check (recording_type in ('screen', 'rrweb')),
  -- MediaRecorder mime (e.g. 'video/webm;codecs=vp9'), needed for playback.
  recording_mime text,
  created_at     timestamptz not null default now()
);

create index sessions_by_test on public.sessions (test_id, created_at);

alter table public.sessions enable row level security;

create policy "participants create sessions"
  on public.sessions
  for insert
  to anon, authenticated
  with check (exists (select 1 from public.tests t where t.id = test_id));

create policy "owners read sessions"
  on public.sessions
  for select
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

-- No update/delete for anon: session rows are written once at consent.

-- ---------- recording_chunks ----------
-- The recording is one continuous WebM stream, uploaded as ~5-minute chunks:
-- "<test_id>/<session_id>/<seq 0-padded>.webm". Concatenated in seq order the
-- chunks form the full video; if a session ends abnormally, the chunks
-- already uploaded still play up to that point.

create table public.recording_chunks (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  seq        int not null,
  path       text not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

alter table public.recording_chunks enable row level security;

-- Anonymous participants can't SELECT from sessions (by design), so policies
-- that need to check "does a matching session exist?" go through
-- security-definer helpers, which can read the table without exposing it.

create or replace function public.chunk_registration_valid(
  p_session uuid,
  p_seq int,
  p_path text
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and s.recording_type is not null
      and p_path = s.test_id || '/' || s.id::text || '/'
                   || lpad(p_seq::text, 4, '0') || '.webm'
  );
$$;

create or replace function public.recording_upload_allowed(p_name text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.id::text = (storage.foldername(p_name))[2]
      and s.test_id = (storage.foldername(p_name))[1]
      and s.recording_type is not null
  );
$$;

grant execute on function public.chunk_registration_valid(uuid, int, text)
  to anon, authenticated;
grant execute on function public.recording_upload_allowed(text)
  to anon, authenticated;

-- Participants append chunk records only for their own recording session,
-- and only with the exact canonical path for that sequence number.
create policy "participants register chunks"
  on public.recording_chunks
  for insert
  to anon, authenticated
  with check (public.chunk_registration_valid(session_id, seq, path));

create policy "owners read chunks"
  on public.recording_chunks
  for select
  to authenticated
  using (exists (
    select 1 from public.sessions s
    join public.tests t on t.id = s.test_id
    where s.id = session_id and t.owner_id = auth.uid()
  ));

-- ---------- storage policies (bucket: recordings) ----------

-- Uploads only into the folder of a registered recording session:
-- name = "<test_id>/<session_id>/<file>". No update policy = no overwrites.
create policy "participants upload recordings"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'recordings'
    and public.recording_upload_allowed(name)
  );

-- Only the owner of the recording's test may read / sign URLs.
create policy "owners read recordings"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and exists (
      select 1 from public.tests t
      where t.id = (storage.foldername(name))[1]
        and t.owner_id = auth.uid()
    )
  );
