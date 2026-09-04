-- Task 1: tell participants the panel can be minimized, so they know the full
-- page is reachable without losing the task. Appended to the existing copy;
-- the guard makes a second run a no-op.
-- Run the whole file in the SQL Editor.

update public.tasks set
  description = description || ' You can minimize this panel any time to see the full page, and open it again when you''re ready.'
where test_id = 'ahs827sd'
  and options->>'key' = 'p1_1_play_orient'
  and description not like '%minimize this panel%';
