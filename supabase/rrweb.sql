-- rrweb ingestion support. Run AFTER recordings.sql (additive — no drops).
--
-- Called by /api/rrweb/ingest with the anon key. Validates that the session
-- is a consented, active rrweb session, then atomically assigns the next
-- chunk sequence number and registers the chunk row. Returns the canonical
-- storage path for the batch, or null if the session isn't eligible.

create or replace function public.register_rrweb_chunk(
  p_session uuid,
  p_size bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test  text;
  v_seq   int;
  v_path  text;
  v_count int;
begin
  select s.test_id into v_test
  from public.sessions s
  where s.id = p_session
    and s.recording_type = 'rrweb'
    and s.consent_status = 'granted'
    and s.created_at > now() - interval '24 hours';
  if v_test is null then
    return null;
  end if;

  -- Runaway/junk guard: cap chunks per session.
  select count(*), coalesce(max(c.seq) + 1, 0)
    into v_count, v_seq
  from public.recording_chunks c
  where c.session_id = p_session;
  if v_count >= 2000 then
    return null;
  end if;

  v_path := v_test || '/' || p_session::text || '/rrweb-'
            || lpad(v_seq::text, 4, '0') || '.json';

  insert into public.recording_chunks (session_id, seq, path, size_bytes)
  values (p_session, v_seq, v_path, p_size);

  return v_path;
end;
$$;

grant execute on function public.register_rrweb_chunk(uuid, bigint)
  to anon, authenticated;
