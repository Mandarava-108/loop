-- Task 3 ("Full transcript"): follow-up on reading comfort, asked under the
-- ease rating once the participant has found the Chinese transcript.
-- Run the whole file in the SQL Editor.

update public.tasks set
  options = options || '{"confirm": {"label": "Were you able to read the text comfortably?", "options": ["Yes", "Mostly", "No"], "store": "p1_3_read_comfort"}}'::jsonb
where test_id = 'ahs827sd' and options->>'key' = 'p1_3_transcript_chinese';
