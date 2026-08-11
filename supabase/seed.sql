-- Demo test for development. Run in the Supabase SQL Editor AFTER schema.sql.
--
-- Prerequisite: at least one user must exist in auth.users, because tests
-- require an owner. Create one in the dashboard first:
--   Authentication -> Users -> Add user -> Create new user
-- (use your own email; check "Auto Confirm User")

insert into public.tests (id, owner_id, title, site_url)
values (
  'demotest',
  (select id from auth.users order by created_at limit 1),
  'Demo — first impressions of example.com',
  'https://example.com'
);

insert into public.tasks (test_id, sort_order, type, prompt, description) values
  ('demotest', 1, 'instruction', 'Look around the page',
   'Take a moment to look at this website and figure out what it is for.'),
  ('demotest', 2, 'instruction', 'Find the "More information" link',
   'Locate the link that leads to more information. You don''t need to click it.'),
  ('demotest', 3, 'rating', 'How easy was that?',
   'Rate how easy it was to find the link.'),
  ('demotest', 4, 'open_text', 'What would you change?',
   'In your own words: what, if anything, felt confusing or slow?');
