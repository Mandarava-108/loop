-- Question mode / task mode split. Run the whole file in the SQL Editor.
--
-- The test site iframe now mounts only when task mode starts, so the
-- recording method (screen vs rrweb) can no longer be decided at consent
-- time. Sessions are still written once at consent (recording_type null);
-- this RPC lets the participant's client set the recording method exactly
-- once, when task mode begins. No general UPDATE access is granted.

create or replace function public.set_session_recording(
  p_session uuid,
  p_type text,
  p_mime text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sessions
  set recording_type = p_type,
      recording_mime = p_mime
  where id = p_session
    and recording_type is null           -- once only
    and consent_status = 'granted'       -- consent still gates recording
    and created_at > now() - interval '24 hours'
    and p_type in ('screen', 'rrweb');
  return found;
end;
$$;

grant execute on function public.set_session_recording(uuid, text, text)
  to anon, authenticated;

-- Spec item 4: enforce screening (flip back to false while piloting on
-- your own phone, or you will screen yourself out at the Device step).
update public.tests
set config = coalesce(config, '{}'::jsonb)
  || '{"STRICT_DEVICE": true, "STRICT_LANGUAGE": true, "REQUIRE_RECORDING": true}'::jsonb
where id = 'ahs827sd';

-- The final open question renders as a full-screen card with no site visible.
update public.tasks
set options = coalesce(options, '{}'::jsonb) || '{"fullscreen": true}'::jsonb
where test_id = 'ahs827sd' and options->>'key' = 'final_open';
