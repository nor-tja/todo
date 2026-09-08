-- todo.katjanorstad.no — data model and Row Level Security.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against a fresh project. Safe to re-run: every statement is
-- idempotent (create-if-not-exists / drop-if-exists-then-create).
--
-- ── Why RLS is not optional ────────────────────────────────────────────
-- The Supabase anon key ships in public JavaScript (see assets/js/config.js).
-- That is normal and safe ONLY because every table below has Row Level
-- Security enabled and a policy that filters every row to
-- `auth.uid() = user_id`. With RLS off, a public anon key is a public
-- database. tests/rls.test.js asserts (statically, against this file) that
-- RLS is enabled on every table declared here — see that file for what it
-- checks and does not check.

create extension if not exists pgcrypto;

-- ── enums ──────────────────────────────────────────────────────────────

do $$ begin
  create type task_context as enum ('work', 'home');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_state as enum ('inbox', 'backlog', 'today', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rhythm_kind as enum ('daily', 'quota', 'scheduled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_kind as enum ('daily', 'weekly');
exception when duplicate_object then null; end $$;

-- ── tasks (Track A) ───────────────────────────────────────────────────

create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null check (char_length(btrim(title)) > 0),
  notes          text,
  context        task_context,               -- null while in inbox
  state          task_state not null default 'inbox',
  deadline       date,                        -- rare, means consequence
  committed_on   date,                        -- which day it was promised to
  declined_count int not null default 0,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  sort_order     int not null default 0
);

create index if not exists tasks_user_state_idx on tasks (user_id, state);
create index if not exists tasks_user_deadline_idx on tasks (user_id, deadline) where deadline is not null;

alter table tasks enable row level security;

drop policy if exists "tasks: owner full access" on tasks;
create policy "tasks: owner full access" on tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── rhythms (Track B) ─────────────────────────────────────────────────

create table if not exists rhythms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) > 0),
  kind          rhythm_kind not null,
  context       task_context not null,
  quota_floor   int,                          -- kind='quota'
  quota_stretch int,                          -- kind='quota'
  weekday       int check (weekday between 0 and 6),      -- kind='scheduled', Monday=0
  day_of_month  int check (day_of_month between 1 and 31), -- kind='scheduled'
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint rhythms_quota_fields check (
    kind <> 'quota' or (quota_floor is not null)
  ),
  constraint rhythms_scheduled_fields check (
    kind <> 'scheduled' or (weekday is not null or day_of_month is not null)
  )
);

create index if not exists rhythms_user_active_idx on rhythms (user_id, active);

alter table rhythms enable row level security;

drop policy if exists "rhythms: owner full access" on rhythms;
create policy "rhythms: owner full access" on rhythms
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── rhythm_log ────────────────────────────────────────────────────────
-- Streaks and quota progress are DERIVED from this table at read time,
-- never stored as a counter — see assets/js/rhythms.js.

create table if not exists rhythm_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rhythm_id  uuid not null references rhythms(id) on delete cascade,
  done_on    date not null,
  created_at timestamptz not null default now(),
  unique (rhythm_id, done_on)
);

create index if not exists rhythm_log_rhythm_idx on rhythm_log (rhythm_id, done_on);

alter table rhythm_log enable row level security;

drop policy if exists "rhythm_log: owner full access" on rhythm_log;
create policy "rhythm_log: owner full access" on rhythm_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── lists (Track C) ───────────────────────────────────────────────────
-- No context column: lists are Home-only by nature and simply absent from
-- the UI in Work mode, per the design spec.

create table if not exists lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) > 0),
  group_name text,
  sort_order int not null default 0
);

create index if not exists lists_user_idx on lists (user_id);

alter table lists enable row level security;

drop policy if exists "lists: owner full access" on lists;
create policy "lists: owner full access" on lists
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists list_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id    uuid not null references lists(id) on delete cascade,
  text       text not null check (char_length(btrim(text)) > 0),
  bought     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists list_items_list_idx on list_items (list_id);

alter table list_items enable row level security;

drop policy if exists "list_items: owner full access" on list_items;
create policy "list_items: owner full access" on list_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── review_sessions ───────────────────────────────────────────────────
-- One row per completed morning/weekly ritual — lets the UI know a ritual
-- was already done today/this week without re-deriving it from task state.

create table if not exists review_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         review_kind not null,
  completed_at timestamptz not null default now()
);

create index if not exists review_sessions_user_kind_idx on review_sessions (user_id, kind, completed_at desc);

alter table review_sessions enable row level security;

drop policy if exists "review_sessions: owner full access" on review_sessions;
create policy "review_sessions: owner full access" on review_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── updated_at bookkeeping on tasks ──────────────────────────────────

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();
