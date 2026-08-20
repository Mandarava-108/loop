-- Study upgrade: usability_task type, per-task options, per-test config,
-- researcher verification — plus the new task set for the Garchen player test.
-- Run the whole file in the SQL Editor (accept the destructive-query warning:
-- it replaces only the tasks of test ahs827sd).

-- ---------- schema ----------

alter table public.tasks add column if not exists options jsonb;
alter table public.tests add column if not exists config jsonb;
alter table public.responses add column if not exists detail jsonb;
alter table public.responses add column if not exists verified text
  check (verified is null or verified in ('success', 'fail'));

-- Extend the allowed task types with 'usability_task'.
do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.tasks'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%type%';
  if c is not null then
    execute format('alter table public.tasks drop constraint %I', c);
  end if;
end $$;
alter table public.tasks add constraint tasks_type_check
  check (type in ('instruction', 'rating', 'open_text', 'usability_task'));

-- Researchers fill in `verified` after reviewing recordings.
drop policy if exists "owners update responses" on public.responses;
create policy "owners update responses"
  on public.responses
  for update
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

-- ---------- Garchen player test: new task set ----------

delete from public.tasks where test_id = 'ahs827sd';

insert into public.tasks (test_id, sort_order, type, prompt, description, options) values
('ahs827sd', 1, 'usability_task',
 'Start playing this teaching',
 'Start playing this teaching. Then tell us: is this part of a longer event? How can you tell?',
 '{"key":"p1_1_play_orient",
   "required_text":{"label":"Is this part of a longer event? How can you tell?","min":20,"store":"p1_1_series_answer"},
   "success_criteria":"Playback started; series answer mentions the playlist/day structure"}'),

('ahs827sd', 2, 'usability_task',
 'Turn on captions in Chinese',
 'While it plays, turn on captions so you can read what''s being said, and set them to Chinese.',
 '{"key":"p1_2_captions_chinese",
   "success_criteria":"Captions visible, Chinese selected"}'),

('ahs827sd', 3, 'usability_task',
 'Find the full transcript in Chinese',
 'Now find a way to read the full text of the teaching in Chinese — something you can scroll through and read ahead in, not just one line at a time.',
 '{"key":"p1_3_transcript_chinese",
   "success_criteria":"Transcript panel open, Chinese selected"}'),

('ahs827sd', 4, 'usability_task',
 'Find the bodhicitta passage',
 'This teaching includes a part where Garchen Rinpoche talks about "bodhicitta." Open the transcript and use it to jump to that moment in the recording.',
 '{"key":"p1_4_bodhicitta",
   "success_criteria":"Transcript opened, \"bodhicitta\" located, player jumps to that point"}'),

('ahs827sd', 5, 'usability_task',
 'Turn off the interpreter''s voice',
 'Set the player so you do not hear the interpreter''s voice.',
 '{"key":"p1_5_interpreter_off",
   "success_criteria":"Interpreter audio option disabled"}'),

('ahs827sd', 6, 'usability_task',
 'Day 3, Session 2',
 'Play the second session from Day 3 of this event.',
 '{"key":"p1_6_day3_session2",
   "success_criteria":"Correct session playing (check displayed duration in recording)"}'),

('ahs827sd', 7, 'usability_task',
 'Get the practice text',
 'Download the practice text PDF that goes with this teaching.',
 '{"key":"p1_7_practice_pdf",
   "success_criteria":"Download triggered from Associated Media"}'),

('ahs827sd', 8, 'usability_task',
 'Audio only',
 'You want to listen without video to save data. Switch to audio.',
 '{"key":"p1_8_audio_only",
   "flag":"INCLUDE_P1_8",
   "success_criteria":"Audio mode active"}'),

('ahs827sd', 9, 'usability_task',
 'Download a video',
 'Download a video and play it back with subtitles.',
 '{"key":"p1_9_video_download",
   "confirm":{"label":"Were the subtitles visible when you played the downloaded file?","options":["Yes","No","I couldn''t open the file"],"store":"p1_9_subtitle_confirm"},
   "success_criteria":"Participant finds downloaded video and plays it back with subtitles"}'),

('ahs827sd', 10, 'open_text',
 'If you could change one thing about this site, what would it be?',
 null,
 '{"key":"final_open","optional":true}');

-- Per-test config: P1.8 excluded by default; duration estimate on consent.
update public.tests
set config = '{"INCLUDE_P1_8": false, "duration_text": "about 15–20 minutes"}'
where id = 'ahs827sd';
