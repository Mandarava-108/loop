-- Loop — initial schema + RLS (SPEC.md step 2)
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- Short random slug for shareable test links, e.g. /t/x7k2m9pq
-- Alphabet omits 0/O/1/l/i to keep links unambiguous when read aloud.
create or replace function public.short_slug()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('23456789abcdefghjkmnpqrstuvwxyz', (floor(random() * 31) + 1)::int, 1),
    ''
  )
  from generate_series(1, 8)
$$;

-- ---------- tables ----------

create table public.tests (
  id         text primary key default public.short_slug(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  site_url   text not null,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  test_id     text not null references public.tests (id) on delete cascade,
  sort_order  int  not null,
  type        text not null check (type in ('instruction', 'rating', 'open_text')),
  prompt      text not null,
  description text
);

create index tasks_by_test on public.tasks (test_id, sort_order);

create table public.responses (
  id           uuid primary key default gen_random_uuid(),
  test_id      text not null references public.tests (id) on delete cascade,
  session_id   uuid not null,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  -- rating stored as '1'..'5'; instruction tasks store 'done' or 'skipped'
  answer       text not null,
  started_at   timestamptz not null,
  submitted_at timestamptz not null default now()
);

create index responses_by_session on public.responses (test_id, session_id);

-- ---------- row-level security ----------

alter table public.tests     enable row level security;
alter table public.tasks     enable row level security;
alter table public.responses enable row level security;

-- tests: owners have full control of their own tests
create policy "owners manage own tests"
  on public.tests
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- tests: participants (no auth) can read a test's config.
-- The unguessable slug is the access control; anyone holding the link may read.
create policy "anyone can read a test by id"
  on public.tests
  for select
  to anon, authenticated
  using (true);

-- tasks: readable by anyone holding the test link
create policy "anyone can read tasks"
  on public.tasks
  for select
  to anon, authenticated
  using (true);

-- tasks: only the owner of the parent test may write
create policy "owners insert tasks"
  on public.tasks
  for insert
  to authenticated
  with check (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

create policy "owners update tasks"
  on public.tasks
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

create policy "owners delete tasks"
  on public.tasks
  for delete
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

-- responses: anonymous participants may submit, but only against a real
-- test/task pair that belong together
create policy "participants submit responses"
  on public.responses
  for insert
  to anon, authenticated
  with check (exists (
    select 1 from public.tasks k
    where k.id = task_id and k.test_id = responses.test_id
  ));

-- responses: only the test owner may read them
create policy "owners read own responses"
  on public.responses
  for select
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));

-- responses: owners may delete (e.g. clearing pilot/test runs)
create policy "owners delete own responses"
  on public.responses
  for delete
  to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = test_id and t.owner_id = auth.uid()
  ));
