-- Screener phase: per-session screener answers + the 4-step screener config
-- for the Garchen player test. Run the whole file in the SQL Editor.

-- One row per session, written once when the screener finishes (or the
-- moment a participant is screened out). Insert-only, like everything
-- participants touch.
create table public.screener_answers (
  session_id   uuid primary key references public.sessions (id) on delete cascade,
  answers      jsonb not null,
  tags         text[] not null default '{}',
  screened_out boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.screener_answers enable row level security;

-- Anon can't SELECT sessions, so the validity check runs security definer.
create or replace function public.screener_session_valid(p_session uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and s.created_at > now() - interval '24 hours'
  );
$$;

grant execute on function public.screener_session_valid(uuid)
  to anon, authenticated;

create policy "participants submit screener"
  on public.screener_answers
  for insert
  to anon, authenticated
  with check (public.screener_session_valid(session_id));

create policy "owners read screener"
  on public.screener_answers
  for select
  to authenticated
  using (exists (
    select 1 from public.sessions s
    join public.tests t on t.id = s.test_id
    where s.id = session_id and t.owner_id = auth.uid()
  ));

-- ---------- screener config for the Garchen player test ----------
-- Steps run in order, after consent, before the first task. No back
-- navigation; all required. STRICT_* = false means "tag and continue"
-- instead of disqualifying — flip to true to enforce screening out.

update public.tests
set config = coalesce(config, '{}'::jsonb) || '{
  "STRICT_DEVICE": false,
  "STRICT_LANGUAGE": false,
  "screener": [
    {
      "id": "device",
      "label": "What device are you using right now?",
      "options": ["Desktop or laptop computer", "Tablet", "Smartphone", "Other"],
      "pass_if_any": ["Desktop or laptop computer"],
      "strict_flag": "STRICT_DEVICE",
      "fail_tag": "mobile",
      "disqualify_message": "This study requires a desktop or laptop. Please come back on a computer!"
    },
    {
      "id": "languages",
      "label": "Which of these languages do you speak comfortably? (Select all that apply)",
      "multi": true,
      "min": 1,
      "options": ["English", "Tibetan", "Chinese", "Spanish", "Other", "None of the above"],
      "exclusive": "None of the above",
      "pass_if_any": ["English"],
      "strict_flag": "STRICT_LANGUAGE",
      "fail_tag": "no_english",
      "disqualify_message": "This study requires comfortable English. Thanks for your interest!"
    },
    {
      "id": "age_range",
      "label": "Which age group are you in?",
      "options": ["18–24", "25–34", "35–44", "45–54", "55–64", "65 or older", "Prefer not to say"]
    },
    {
      "id": "familiarity",
      "label": "How familiar are you with Garchen Rinpoche''s teachings?",
      "options": ["I''ve never heard of them", "Somewhat familiar — I''ve seen or heard a few", "I follow them regularly"]
    }
  ]
}'::jsonb
where id = 'ahs827sd';
