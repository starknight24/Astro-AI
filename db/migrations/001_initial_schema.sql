-- AstroAI initial schema (v1)
-- Run in: Supabase Dashboard -> SQL Editor. Lives in: db/migrations/001_initial_schema.sql
-- Decisions annotated inline; see ADR-002 for the pgvector choice.

create extension if not exists vector;

-- ============ Identity ============
-- DECISION: public.users references Supabase's auth.users so auth identity and
-- app data share one id. Row is inserted by the API on first authenticated request.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- ============ Chat ============
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  -- DECISION: role is constrained, not free text. Free-text enums rot.
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_messages_session on public.messages(session_id);

-- ============ Papers / RAG ============
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  storage_path text not null,
  -- DECISION: constrained lifecycle so the UI can show upload progress honestly.
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table public.paper_chunks (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  page int not null,
  section text,
  content text not null,
  -- DECISION: dimension left unspecified until the embedding model is chosen
  -- (Week 5). Storage works untyped; the ANN index added later needs fixed dims,
  -- so migration 00X will ALTER to vector(<dims>) when the model is locked.
  embedding vector,
  created_at timestamptz not null default now()
);
create index idx_chunks_paper on public.paper_chunks(paper_id);

-- ============ Observability ============
-- DECISION: one row = one LLM call. A multi-tool agent request produces several
-- rows sharing a request_id. DECISION: deliberately NO foreign keys — traces must
-- record even requests that fail before touching users/messages. user_id is a
-- loose uuid, nullable (unauthenticated/system calls).
create table public.agent_traces (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid,
  route text not null,
  model text not null,
  prompt_version text,
  tokens_in int,
  tokens_out int,
  -- DECISION: money is numeric, never float.
  cost_usd numeric(10, 6),
  latency_ms int,
  outcome text not null check (outcome in ('ok', 'error', 'refused', 'timeout')),
  created_at timestamptz not null default now()
);
create index idx_traces_request on public.agent_traces(request_id);
create index idx_traces_created on public.agent_traces(created_at);

-- ============ Evals ============
-- One row per eval-suite execution: the CONDITIONS under test.
create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  git_sha text not null,
  prompt_version text,
  model text not null,
  suite text not null check (suite in ('physics', 'rag')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One row per question per run: what HAPPENED.
create table public.eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.eval_runs(id) on delete cascade,
  question_id text not null,
  passed boolean not null,
  score numeric,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_eval_results_run on public.eval_results(run_id);

-- ============ Security ============
-- DECISION: RLS enabled everywhere with NO policies = deny-all through Supabase's
-- public PostgREST API. The frontend never touches the DB directly; only the
-- Express API (service-role connection, bypasses RLS) reads/writes. Without this,
-- anyone holding the public anon key could read every table.
alter table public.users enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages enable row level security;
alter table public.papers enable row level security;
alter table public.paper_chunks enable row level security;
alter table public.agent_traces enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_results enable row level security;
