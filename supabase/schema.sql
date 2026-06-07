-- Apply this in Supabase SQL Editor

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1) Interview sessions table
create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),

  company text not null,
  topic text not null,
  duration_minutes int not null,

  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  elapsed_seconds int not null default 0,

  agent_score numeric null,

  created_at timestamptz not null default now()
);


alter table public.interview_sessions
  add column if not exists include_topics text[] not null default '{}'::text[];

alter table public.interview_sessions
  add column if not exists exclude_topics text[] not null default '{}'::text[];

create index if not exists interview_sessions_user_created_idx
  on public.interview_sessions (user_id, created_at desc);

alter table public.interview_sessions enable row level security;

-- Users can read their own sessions
drop policy if exists "interview_sessions_select_own" on public.interview_sessions;
create policy "interview_sessions_select_own"
  on public.interview_sessions
  for select
  using (user_id = auth.uid());

-- Users can create their own sessions
drop policy if exists "interview_sessions_insert_own" on public.interview_sessions;
create policy "interview_sessions_insert_own"
  on public.interview_sessions
  for insert
  with check (user_id = auth.uid());

-- Users can update their own sessions
drop policy if exists "interview_sessions_update_own" on public.interview_sessions;
create policy "interview_sessions_update_own"
  on public.interview_sessions
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- (Optional) users can delete their own sessions
drop policy if exists "interview_sessions_delete_own" on public.interview_sessions;
create policy "interview_sessions_delete_own"
  on public.interview_sessions
  for delete
  using (user_id = auth.uid());


-- 2) DSA question bank table
-- NOTE: Seeding is intentionally not included here yet because the workspace
-- does not currently contain the attached DSA dataset file (JSON/CSV/etc.).
-- Once you provide it, we can generate the corresponding INSERT statements.
create table if not exists public.dsa_questions (
  id uuid primary key default gen_random_uuid(),

  -- Identifiers / metadata
  slug text unique null,
  source text null,
  source_id text null,
  source_url text null,

  -- Core fields
  title text not null,
  difficulty text null check (difficulty in ('Easy', 'Medium', 'Hard')),
  topics text[] not null default '{}'::text[],
  companies text[] not null default '{}'::text[],

  prompt text null,
  constraints text null,

  -- Flexible structured fields for examples, test cases, editorial, etc.
  examples jsonb not null default '[]'::jsonb,
  hints jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dsa_questions_difficulty_idx
  on public.dsa_questions (difficulty);

create index if not exists dsa_questions_topics_gin
  on public.dsa_questions using gin (topics);

create index if not exists dsa_questions_companies_gin
  on public.dsa_questions using gin (companies);

alter table public.dsa_questions enable row level security;

-- Allow public read access to the question bank and metadata.
drop policy if exists "dsa_questions_select_authenticated" on public.dsa_questions;
drop policy if exists "dsa_questions_select_public" on public.dsa_questions;
create policy "dsa_questions_select_public"
  on public.dsa_questions
  for select
  using (true);

-- No insert/update/delete policies by default (locked down).


-- 3) Track which questions were served in a session (prevents repeats)
create table if not exists public.interview_session_questions (
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  question_id uuid not null references public.dsa_questions(id) on delete restrict,
  served_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

create index if not exists interview_session_questions_session_served_idx
  on public.interview_session_questions (session_id, served_at desc);

alter table public.interview_session_questions enable row level security;

drop policy if exists "interview_session_questions_select_own" on public.interview_session_questions;
create policy "interview_session_questions_select_own"
  on public.interview_session_questions
  for select
  using (
    exists (
      select 1
      from public.interview_sessions s
      where s.id = interview_session_questions.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "interview_session_questions_insert_own" on public.interview_session_questions;
create policy "interview_session_questions_insert_own"
  on public.interview_session_questions
  for insert
  with check (
    exists (
      select 1
      from public.interview_sessions s
      where s.id = interview_session_questions.session_id
        and s.user_id = auth.uid()
    )
  );

-- 4) Interview feedback persisted across sessions
create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  user_id uuid null,
  overall_score int not null,
  score int not null,
  introduction_score int not null,
  approach_score int not null,
  coding_score int not null,
  communication_score int not null,
  time_complexity_accuracy int not null,
  space_complexity_accuracy int not null,
  time_complexity text,
  space_complexity text,
  justification text not null,
  gaps_identified text[] not null default '{}'::text[],
  strengths text[] not null default '{}'::text[],
  suggested_followup text,
  full_feedback jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_feedback_session_idx
  on public.interview_feedback (session_id);

alter table public.interview_feedback enable row level security;

drop policy if exists "interview_feedback_select_own" on public.interview_feedback;
create policy "interview_feedback_select_own"
  on public.interview_feedback
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.interview_sessions s
      where s.id = interview_feedback.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "interview_feedback_insert_own" on public.interview_feedback;
create policy "interview_feedback_insert_own"
  on public.interview_feedback
  for insert
  with check (user_id = auth.uid() or user_id is null);


-- 5) RPC helper: pick a random question by company, with include/exclude topics.
-- PostgREST doesn't support `order by random()` directly in a normal select,
-- so using an RPC keeps the client code simple.
create or replace function public.get_company_options()
returns text[]
language sql
stable
as $$
  select coalesce(
    array_agg(company order by company),
    '{}'::text[]
  )
  from (
    select distinct u.company
    from public.dsa_questions q
    cross join lateral unnest(q.companies) as u(company)
    where u.company is not null
      and u.company <> ''
  ) companies;
$$;

grant execute on function public.get_company_options() to anon, authenticated;

create or replace function public.get_topic_options()
returns text[]
language sql
stable
as $$
  select coalesce(
    array_agg(topic order by topic),
    '{}'::text[]
  )
  from (
    select distinct u.topic
    from public.dsa_questions q
    cross join lateral unnest(q.topics) as u(topic)
    where u.topic is not null
      and u.topic <> ''
  ) topics;
$$;

grant execute on function public.get_topic_options() to anon, authenticated;

create or replace function public.pick_random_dsa_question(
  p_company text,
  p_include_topics text[] default null,
  p_exclude_topics text[] default null,
  p_difficulty text default null,
  p_session_id uuid default null
)
returns public.dsa_questions
language sql
volatile
as $$
  select q.*
  from public.dsa_questions q
  where (p_company is null or q.companies @> array[p_company]::text[])
    and (p_difficulty is null or q.difficulty = p_difficulty)
    and (
      p_include_topics is null
      or cardinality(p_include_topics) = 0
      or q.topics && p_include_topics
    )
    and (
      p_exclude_topics is null
      or cardinality(p_exclude_topics) = 0
      or not (q.topics && p_exclude_topics)
    )
    and (
      p_session_id is null
      or not exists (
        select 1
        from public.interview_session_questions sq
        where sq.session_id = p_session_id
          and sq.question_id = q.id
      )
    )
  order by random()
  limit 1;
$$;

grant execute on function public.pick_random_dsa_question(text, text[], text[], text, uuid) to authenticated;

-- 3) Messages table for contact form
create table if not exists public.messages (
  id bigserial primary key,
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz default now(),
  sent_to_email boolean default false
);

-- Enable RLS
alter table public.messages enable row level security;

-- Anyone can insert messages
create policy "Anyone can insert messages" on public.messages
  for insert
  with check (true);

-- Create index on created_at for sorting
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);
