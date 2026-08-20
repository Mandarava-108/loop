-- Task copy fix: short titles (labels, not sentences), non-repeating
-- prompts, and the new P1.1 look-then-play flow with a single Continue.
-- Run the whole file in the SQL Editor.

update public.tasks set
  prompt = 'Look, then play',
  description = 'Take a look around this page for a few seconds without clicking anything. Just from what you can see: does this teaching seem to be part of a longer event or series? How can you tell? Type your answer below — then start playing the teaching. It only needs to play for a moment, no need to watch it.',
  options = options || '{"single_continue": true, "required_text": {"label": "Your answer", "min": 20, "store": "p1_1_series_answer"}}'::jsonb
where test_id = 'ahs827sd' and options->>'key' = 'p1_1_play_orient';

update public.tasks set prompt = 'Captions'
where test_id = 'ahs827sd' and options->>'key' = 'p1_2_captions_chinese';

update public.tasks set prompt = 'Full transcript'
where test_id = 'ahs827sd' and options->>'key' = 'p1_3_transcript_chinese';

update public.tasks set prompt = 'Find a passage'
where test_id = 'ahs827sd' and options->>'key' = 'p1_4_bodhicitta';

update public.tasks set prompt = 'Interpreter audio'
where test_id = 'ahs827sd' and options->>'key' = 'p1_5_interpreter_off';

update public.tasks set prompt = 'Day 3, Session 2'
where test_id = 'ahs827sd' and options->>'key' = 'p1_6_day3_session2';

update public.tasks set prompt = 'Practice text'
where test_id = 'ahs827sd' and options->>'key' = 'p1_7_practice_pdf';

update public.tasks set prompt = 'Audio only'
where test_id = 'ahs827sd' and options->>'key' = 'p1_8_audio_only';

update public.tasks set prompt = 'Download a video'
where test_id = 'ahs827sd' and options->>'key' = 'p1_9_video_download';
