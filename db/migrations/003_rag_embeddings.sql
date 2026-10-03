-- AstroAI migration 003 — RAG: fixed embedding dimension, chunk metadata, indexes (Week 5)
-- Run in: Supabase Dashboard -> SQL Editor. Lives in: db/migrations/003_rag_embeddings.sql
-- Decisions annotated inline; see ADR-006 for chunking and retrieval reasoning.

-- ============ Embedding dimension ============
-- Migration 001 deliberately left `embedding vector` untyped "until the
-- embedding model is chosen (Week 5)". It is now chosen: gemini-embedding-001
-- truncated to 768 dimensions and re-normalised.
--
-- DECISION: 768, not the model's native 3072. Measured, not assumed — pgvector
-- 0.8.0 refuses to build either ANN index above 2000 dimensions:
--     "column cannot have more than 2000 dimensions for hnsw index"
-- A 3072-dim column can only ever be scanned sequentially, which forfeits the
-- entire reason for choosing pgvector. 768 also cuts row width and distance
-- cost 4x, and the model is trained (Matryoshka) for truncation.
--
-- SAFETY: this ALTER rewrites the column type. It succeeds on an empty table
-- and on rows that already hold 768-dim vectors; it fails loudly otherwise
-- rather than silently discarding vectors. Re-embed after changing dimension.
do $$
begin
  if exists (
    select 1 from public.paper_chunks where embedding is not null limit 1
  ) and exists (
    select 1 from public.paper_chunks
    where embedding is not null and vector_dims(embedding) <> 768 limit 1
  ) then
    raise exception
      'paper_chunks holds embeddings whose dimension is not 768. Delete them and re-ingest before running this migration.';
  end if;
end $$;

alter table public.paper_chunks
  alter column embedding type vector(768);

-- ============ Chunk metadata ============
-- DECISION: page_end as well as page. A chunk may cross a page break, and a
-- citation that says "p. 7" when the sentence is on page 8 is a wrong citation.
alter table public.paper_chunks
  add column if not exists page_end int,
  add column if not exists section_path text,
  -- DECISION: section_index as well as section_path. Sections must be listed in
  -- document order, and ordering by path is wrong — "10. Appendix" sorts before
  -- "2. Data" lexically.
  add column if not exists section_index int,
  add column if not exists chunk_index int,
  add column if not exists char_count int;

update public.paper_chunks set page_end = page where page_end is null;

-- DECISION: a generated tsvector column, not a query-time to_tsvector call.
-- Hybrid retrieval runs keyword matching on every query; computing the vector
-- per query per row cannot use an index. Stored means the GIN index applies.
alter table public.paper_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

-- One chunk_index per paper. Makes re-ingestion an upsert rather than a
-- duplicate, and gives retrieval a stable key to cite.
create unique index if not exists idx_chunks_paper_chunk
  on public.paper_chunks(paper_id, chunk_index);

-- ============ Retrieval indexes ============
-- DECISION: HNSW over IVFFlat. IVFFlat needs a representative sample to build
-- its lists and degrades when the corpus grows past the sample; HNSW builds
-- incrementally, which suits a corpus that grows one uploaded paper at a time.
-- DECISION: cosine ops. Embeddings are L2-normalised, so cosine and inner
-- product rank identically, but cosine stays correct if normalisation is ever
-- missed.
create index if not exists idx_chunks_embedding_hnsw
  on public.paper_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_chunks_tsv
  on public.paper_chunks using gin (content_tsv);

-- Retrieval always filters to one paper first (a user asks questions of a
-- specific paper), so the paper_id btree from migration 001 does the heavy
-- lifting and the ANN index refines within it.

-- ============ Paper ingestion state ============
alter table public.papers
  add column if not exists page_count int,
  add column if not exists chunk_count int,
  -- Extraction warnings (scanned pages, no headings found) shown to the user
  -- instead of being swallowed, so a bad answer has a visible cause.
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  -- SHA-256 of the uploaded bytes. Re-uploading the same file is recognised
  -- rather than duplicated; Week 7's idempotency keys build on this.
  add column if not exists content_hash text,
  -- Which model and chunk settings produced this index. Week 6's experiment
  -- varies one of these, and a run is only interpretable if it is recorded.
  add column if not exists embedding_model text,
  add column if not exists chunk_config jsonb not null default '{}'::jsonb,
  add column if not exists error text;

create index if not exists idx_papers_user on public.papers(user_id);
create unique index if not exists idx_papers_user_hash
  on public.papers(user_id, content_hash) where content_hash is not null;

-- ============ Paper Q&A threads ============
-- DECISION: a thread is anchored to one paper, not to a global chat. The Week-5
-- product requirement is a conversation "within the context of that paper", and
-- a paper_id on the thread is what makes retrieval scoping a foreign key rather
-- than a convention.
create table if not exists public.paper_threads (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_paper_threads_paper on public.paper_threads(paper_id);

create table if not exists public.paper_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.paper_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- The chunks this answer was grounded in: [{chunk_index, page, section, score}].
  -- Stored so a citation can be re-checked after the fact, which is the whole
  -- point of citing.
  citations jsonb not null default '[]'::jsonb,
  -- 'answered' | 'refused_unsupported' — refusals are first-class, and Week 6
  -- measures how often they fire.
  outcome text not null default 'answered'
    check (outcome in ('answered', 'refused_unsupported', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists idx_paper_messages_thread on public.paper_messages(thread_id, created_at);

-- ============ Security ============
alter table public.paper_threads enable row level security;
alter table public.paper_messages enable row level security;
