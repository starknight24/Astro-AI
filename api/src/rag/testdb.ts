/**
 * An in-process Postgres for tests, so the retrieval SQL is exercised against
 * real pgvector rather than a mock.
 *
 * PGlite is PostgreSQL 17 compiled to WASM with the pgvector extension — HNSW
 * indexes, the `<=>` cosine operator and `websearch_to_tsquery` all behave as
 * they do in Supabase. Without it the only options were mocking `pool.query`
 * (which tests nothing about the SQL) or requiring Docker in CI.
 *
 * Test-only: `@electric-sql/pglite` is a devDependency and production still
 * talks to Supabase through `pg`.
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { EMBEDDING_DIMENSIONS } from "../lib/embeddings";
import type { Queryable } from "./store";

export interface TestDb extends Queryable {
  close(): Promise<void>;
}

/**
 * The subset of the production schema the tests touch, matching migrations 001,
 * 003 and 004. Kept narrow on purpose: a full copy of the schema would drift,
 * and these tests are about behaviour, not about auth tables.
 */
const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE papers (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    title text NOT NULL,
    storage_path text NOT NULL,
    status text NOT NULL DEFAULT 'uploaded'
      CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
    page_count int,
    chunk_count int,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_hash text,
    embedding_model text,
    chunk_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX idx_papers_user_hash ON papers(user_id, content_hash)
    WHERE content_hash IS NOT NULL;

  CREATE TABLE paper_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE paper_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES paper_threads(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    citations jsonb NOT NULL DEFAULT '[]'::jsonb,
    outcome text NOT NULL DEFAULT 'answered'
      CHECK (outcome IN ('answered', 'refused_unsupported', 'error')),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE agent_traces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL,
    user_id uuid,
    route text NOT NULL,
    model text NOT NULL,
    prompt_version text,
    tokens_in int,
    tokens_out int,
    cost_usd numeric(10, 6),
    latency_ms int,
    outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'refused', 'timeout')),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_traces_request ON agent_traces(request_id);
  CREATE INDEX idx_traces_created ON agent_traces(created_at);

  CREATE TABLE agent_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL,
    user_id uuid,
    tool text NOT NULL,
    iteration int NOT NULL,
    args jsonb NOT NULL DEFAULT '{}'::jsonb,
    outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'refused', 'timeout')),
    error_kind text,
    attempts int NOT NULL DEFAULT 1,
    latency_ms int NOT NULL,
    cache_hit boolean,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_tool_calls_request ON agent_tool_calls(request_id);
  CREATE INDEX idx_tool_calls_tool_created ON agent_tool_calls(tool, created_at);

  CREATE TABLE rate_limit_counters (
    bucket text NOT NULL,
    key text NOT NULL,
    window_start timestamptz NOT NULL,
    count int NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key, window_start)
  );

  CREATE TABLE idempotency_keys (
    key text NOT NULL,
    user_id uuid NOT NULL,
    route text NOT NULL,
    request_hash text NOT NULL,
    state text NOT NULL DEFAULT 'in_progress'
      CHECK (state IN ('in_progress', 'completed', 'failed')),
    response_status int,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    PRIMARY KEY (key, user_id, route)
  );

  CREATE TABLE paper_chunks (
    id serial PRIMARY KEY,
    paper_id text NOT NULL,
    chunk_index int NOT NULL,
    content text NOT NULL,
    page int NOT NULL,
    page_end int,
    section text,
    section_path text,
    section_index int,
    char_count int,
    embedding vector(${EMBEDDING_DIMENSIONS}),
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX idx_chunks_paper_chunk ON paper_chunks(paper_id, chunk_index);
  CREATE INDEX idx_chunks_paper ON paper_chunks(paper_id);
  CREATE INDEX idx_chunks_embedding_hnsw ON paper_chunks USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX idx_chunks_tsv ON paper_chunks USING gin (content_tsv);
`;

export async function createTestDb(): Promise<TestDb> {
  const db = await new PGlite({ extensions: { vector } });
  await db.exec(SCHEMA);
  // The production SQL is schema-qualified; PGlite's default search_path puts
  // these tables in `public`, so `public.paper_chunks` resolves unchanged.
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const result = await db.query<T>(sql, params as never[]);
      return { rows: result.rows };
    },
    close: () => db.close(),
  };
}

/**
 * A deterministic unit vector that points mostly along `axis`.
 *
 * Tests need embeddings whose similarity ordering is known without calling a
 * model. Each axis gets its own dominant dimension plus a fixed pseudo-random
 * tail, so vectors on the same axis are near-identical and vectors on different
 * axes are far apart.
 */
export function fakeEmbedding(axis: number, jitter = 0): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    values[i] = Math.sin((i + 1) * 0.013 + axis) * 0.01;
  }
  values[axis % EMBEDDING_DIMENSIONS] = 1;
  if (jitter) values[(axis + 1) % EMBEDDING_DIMENSIONS] = jitter;
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return values.map((v) => v / norm);
}
