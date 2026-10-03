-- AstroAI migration 004 — rate limiting + idempotency keys (Week 7)
-- Run in: Supabase Dashboard -> SQL Editor. Lives in: db/migrations/004_rate_limits_and_idempotency.sql
-- Additive only. Decisions annotated inline; see ADR-008.

-- ============ Rate limiting ============
-- DECISION: fixed-window counters in Postgres, not a token bucket in memory.
-- Per-user limits have to hold across instances, and an in-memory counter on a
-- two-instance deploy silently doubles every limit. Postgres is already the
-- shared store (ADR-002), and one indexed upsert per request is cheap next to
-- the three model calls the limit exists to protect.
--
-- DECISION: fixed window, not sliding. A sliding window needs either a sorted
-- set of timestamps per key or a second table; the cost of a fixed window is
-- that a caller can burst across a boundary (up to 2x the limit in one instant).
-- For protecting a metered API budget over minutes and hours, that is
-- acceptable; for anything security-critical it would not be.
create table if not exists public.rate_limit_counters (
  -- Which limit: 'api', 'agent', 'upload'. Named so one caller hitting the
  -- expensive bucket does not consume the cheap one.
  bucket text not null,
  -- 'user:<uuid>' or 'ip:<address>'. A string so both kinds share one table.
  key text not null,
  -- Start of the fixed window, truncated to the window size.
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, key, window_start)
);
-- Sweeping old windows is a range scan over this.
create index if not exists idx_rate_limit_window on public.rate_limit_counters(window_start);

-- ============ Idempotency ============
-- DECISION: the key is scoped to (user, route, key) and stores a hash of the
-- request body. A replay with the SAME key and a DIFFERENT body is a client bug
-- (a reused key), not a retry, and returning the first response for it would
-- hide the bug. That case is rejected with 422 instead.
-- DECISION: the response is stored so a retry returns the original result rather
-- than re-running the work. For /api/papers that means a network retry cannot
-- produce a second ingestion, and for /api/agent/solve it cannot produce a
-- second set of model calls.
create table if not exists public.idempotency_keys (
  key text not null,
  user_id uuid not null,
  route text not null,
  -- SHA-256 of the canonical request body.
  request_hash text not null,
  -- 'in_progress' until the handler finishes, so a concurrent duplicate gets a
  -- 409 rather than racing into the same work.
  state text not null default 'in_progress' check (state in ('in_progress', 'completed', 'failed')),
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (key, user_id, route)
);
create index if not exists idx_idempotency_created on public.idempotency_keys(created_at);

-- ============ Security ============
alter table public.rate_limit_counters enable row level security;
alter table public.idempotency_keys enable row level security;
