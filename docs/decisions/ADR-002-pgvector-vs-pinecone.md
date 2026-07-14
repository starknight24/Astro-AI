# ADR-002: Vector Store — pgvector on Supabase vs. Pinecone

**Status:** Accepted · **Date:** 2026-07-14

## Context

The Research Paper RAG feature (Week 5) requires vector similarity search over embedded chunks of uploaded papers. Each chunk carries relational metadata — paper, page, section, owning user — that must be filtered and joined at query time (a user may only search their own papers). The project is already committed to Supabase Postgres for all relational data (ADR-001 context), is run by a solo developer, and targets a modest corpus: dozens of papers per user, thousands to low hundreds of thousands of chunks overall — not millions.

The original project plan specified Pinecone as a dedicated managed vector database. This decision re-examines that default.

## Decision

Use the **pgvector** extension on the existing Supabase Postgres database. Chunks live in a `paper_chunks` table with an `embedding vector` column alongside their metadata; retrieval is a SQL query.

Three reasons, in order of weight:

1. **One database.** Chunks and their metadata live in the same Postgres, so filtering by user, paper, page, or section is an ordinary SQL join/WHERE — no synchronizing metadata between two systems and no two-phase queries.
2. **Fewer moving parts.** No second vendor, second API client, second set of credentials, or second failure mode. For a solo developer, every service not run is maintenance not paid.
3. **No extra network hop.** Retrieval happens inside the database the API already talks to, rather than an additional round trip to an external vector service on every query.

## Alternatives Considered

**Pinecone (managed vector DB).** Purpose-built: better recall/latency characteristics at large scale, managed index tuning, and horizontal scaling that Postgres cannot match. Rejected at this project's scale because those strengths solve problems I do not have, at the cost of a second vendor and split metadata.

**Qdrant / Weaviate (self- or cloud-hosted vector engines).** Same shape of tradeoff as Pinecone (dedicated engine, separate service), with added self-hosting or vendor-onboarding cost. Same rejection reasoning.

**No vector store (keyword/BM25 only).** Simplest possible retrieval, but abandons semantic search entirely; academic-paper Q&A depends on meaning-level matching. Kept in mind only as a *component* of hybrid retrieval later, not a replacement.

## Consequences

RAG needs one `CREATE EXTENSION vector;` and one column — no new infrastructure. Query-time user isolation is a WHERE clause. The eval harness (Week 6) can join retrieval results to gold labels in SQL.

The accepted limitation is the **scale and recall ceiling versus a dedicated vector engine**: pgvector's ANN indexes (HNSW/IVFFlat) are good but not state of the art at large corpus sizes, and I now own index selection and tuning myself. The vector workload also shares compute with the main database, which is acceptable at this scale but is a known coupling.

**Revisit trigger:** if retrieval latency misses the performance budget (Week 7 targets) even after proper index tuning, I will migrate the chunk store to a dedicated vector database and accept the metadata-synchronization cost. Corpus growth into the multi-million-chunk range would prompt the same re-evaluation.
