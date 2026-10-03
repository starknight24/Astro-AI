-- AstroAI migration 002 — agent tool tracing + third-party response cache (Week 4)
-- Run in: Supabase Dashboard -> SQL Editor. Lives in: db/migrations/002_agent_cache_and_tool_calls.sql
-- Additive only: no existing table is altered and no data is moved.
-- Decisions annotated inline; see ADR-005 for the agent design.

-- ============ Third-party response cache ============
-- DECISION: cache in Postgres rather than adding Redis. The data cached here is
-- small, public, and hour-stale-tolerant (NASA APOD/NeoWs); a second datastore
-- would be more operational surface than the problem deserves (ADR-002's
-- "one database" reasoning applied to caching).
-- DECISION: value is jsonb, not text. Cache entries are inspectable with SQL
-- when a tool returns something surprising.
create table if not exists public.api_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Sweeping expired rows is a range scan over this index.
create index if not exists idx_api_cache_expires on public.api_cache(expires_at);

-- ============ Agent tool calls ============
-- DECISION: tool calls get their own table instead of reusing agent_traces.
-- agent_traces is documented as "one row = one LLM call" and its columns
-- (model, tokens_in/out, prompt_version) describe model invocations; a tool call
-- has different facts (arguments, attempts, cache hit). Both share request_id,
-- so one agent request is reconstructed by joining on it.
-- DECISION: no foreign keys, matching agent_traces — a trace must record even
-- when the request failed before touching users.
create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid,
  tool text not null,
  -- Which round of the agent loop issued this call (1..MAX_TOOL_ITERATIONS).
  iteration int not null,
  -- Arguments AFTER Zod validation, so the row shows what actually ran.
  args jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('ok', 'error', 'refused', 'timeout')),
  -- validation | input | transient | timeout | unknown_tool — null when ok.
  error_kind text,
  -- Attempts including the first; >1 means the retry/backoff path fired.
  attempts int not null default 1,
  latency_ms int not null,
  -- Null when the tool has no cache (the physics engine); true/false otherwise.
  cache_hit boolean,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_calls_request on public.agent_tool_calls(request_id);
create index if not exists idx_tool_calls_created on public.agent_tool_calls(created_at);
-- Week 7 reads per-tool latency percentiles off this.
create index if not exists idx_tool_calls_tool_created on public.agent_tool_calls(tool, created_at);

-- ============ Security ============
-- Same posture as migration 001: RLS on, no policies => deny-all through the
-- public PostgREST API. Only the Express API (service-role connection) reads
-- and writes these tables.
alter table public.api_cache enable row level security;
alter table public.agent_tool_calls enable row level security;
