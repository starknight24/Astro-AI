/**
 * Chunk storage and retrieval over pgvector.
 *
 * Retrieval is "hybrid-lite" (ADR-006): a vector top-k and a Postgres
 * full-text top-k are each computed, then fused by Reciprocal Rank Fusion.
 * Not a tuned BM25 blend — RRF needs no score calibration between two scales
 * that are not comparable (cosine distance vs ts_rank), which is exactly the
 * problem a weighted sum has.
 *
 * Why keyword matching at all, when embeddings are supposed to handle meaning:
 * papers are full of identifiers that carry no semantics — "NORAD ID 56205",
 * "NRLMSISE-00", "FACSAT-2", "G0.11-0.11". A reader asking about one of those
 * wants the exact string, and a dense vector is the wrong tool for it.
 *
 * Every query is scoped to one paper_id. The scope is a WHERE clause, which is
 * the concrete payoff ADR-002 predicted from keeping chunks in Postgres.
 */
import type { Pool } from "pg";
import { EMBEDDING_DIMENSIONS, toVectorLiteral } from "../lib/embeddings";

/** Candidates pulled from each retriever before fusion. */
export const CANDIDATE_POOL = 20;

/** Default chunks handed to the answerer. */
export const DEFAULT_TOP_K = 6;

/** RRF's rank damping constant. 60 is the value from the original paper. */
export const RRF_K = 60;

export interface ChunkInput {
  chunk_index: number;
  content: string;
  page: number;
  page_end: number;
  section: string | null;
  section_path: string | null;
  /** Document order of the section, so sections can be listed as they appear. */
  section_index: number;
  char_count: number;
}

export interface RetrievedChunk {
  chunk_index: number;
  content: string;
  page: number;
  page_end: number;
  section: string | null;
  section_path: string | null;
  /** Cosine similarity in [-1, 1]; null when only keyword search found it. */
  vector_score: number | null;
  /** ts_rank; null when only vector search found it. */
  keyword_score: number | null;
  /** Fused rank score used for ordering. */
  score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
}

/** Minimal surface so tests can run against PGlite instead of pg. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function asQueryable(pool: Pool): Queryable {
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };
}

/**
 * Replace a paper's chunks with a new set.
 *
 * Delete-then-insert rather than a per-row upsert: re-ingesting with a
 * different chunk size produces a different *number* of chunks, so stale rows
 * beyond the new count would survive an upsert and be retrievable forever.
 */
export async function replaceChunks(
  db: Queryable,
  paperId: string,
  chunks: ChunkInput[],
  embeddings: number[][],
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `chunk/embedding count mismatch: ${chunks.length} chunks, ${embeddings.length} embeddings`,
    );
  }
  for (const vector of embeddings) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  await db.query("DELETE FROM public.paper_chunks WHERE paper_id = $1", [
    paperId,
  ]);
  if (chunks.length === 0) return 0;

  // One multi-row INSERT rather than a statement per chunk: a 300-chunk paper
  // would otherwise be 300 round trips.
  const columns = 10;
  const values: unknown[] = [];
  const tuples = chunks.map((chunk, i) => {
    const base = i * columns;
    values.push(
      paperId,
      chunk.chunk_index,
      chunk.content,
      chunk.page,
      chunk.page_end,
      chunk.section,
      chunk.section_path,
      chunk.section_index,
      chunk.char_count,
      toVectorLiteral(embeddings[i]),
    );
    const slots = Array.from({ length: columns }, (_, k) => `$${base + k + 1}`);
    slots[columns - 1] += "::vector";
    return `(${slots.join(", ")})`;
  });

  await db.query(
    `INSERT INTO public.paper_chunks
       (paper_id, chunk_index, content, page, page_end, section, section_path,
        section_index, char_count, embedding)
     VALUES ${tuples.join(", ")}`,
    values,
  );
  return chunks.length;
}

interface VectorRow {
  chunk_index: number;
  content: string;
  page: number;
  page_end: number | null;
  section: string | null;
  section_path: string | null;
  similarity: string | number;
}

interface KeywordRow {
  chunk_index: number;
  content: string;
  page: number;
  page_end: number | null;
  section: string | null;
  section_path: string | null;
  rank: string | number;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

export interface RetrieveOptions {
  topK?: number;
  candidatePool?: number;
  /** Set false to measure vector-only retrieval (Week 6 experiment). */
  hybrid?: boolean;
}

export async function retrieve(
  db: Queryable,
  paperId: string,
  queryText: string,
  queryEmbedding: number[],
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const pool = options.candidatePool ?? CANDIDATE_POOL;
  const hybrid = options.hybrid ?? true;

  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `query embedding has ${queryEmbedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const { rows: vectorRows } = await db.query<VectorRow>(
    `SELECT chunk_index, content, page, page_end, section, section_path,
            1 - (embedding <=> $2::vector) AS similarity
       FROM public.paper_chunks
      WHERE paper_id = $1 AND embedding IS NOT NULL
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [paperId, toVectorLiteral(queryEmbedding), pool],
  );

  let keywordRows: KeywordRow[] = [];
  if (hybrid && queryText.trim()) {
    // websearch_to_tsquery tolerates the punctuation real questions contain
    // ("NRLMSISE-00?") where plainto_tsquery and to_tsquery do not.
    const result = await db.query<KeywordRow>(
      `SELECT chunk_index, content, page, page_end, section, section_path,
              ts_rank(content_tsv, websearch_to_tsquery('english', $2)) AS rank
         FROM public.paper_chunks
        WHERE paper_id = $1
          AND content_tsv @@ websearch_to_tsquery('english', $2)
        ORDER BY rank DESC
        LIMIT $3`,
      [paperId, queryText, pool],
    );
    keywordRows = result.rows;
  }

  const merged = new Map<number, RetrievedChunk>();

  vectorRows.forEach((row, index) => {
    merged.set(row.chunk_index, {
      chunk_index: row.chunk_index,
      content: row.content,
      page: row.page,
      page_end: row.page_end ?? row.page,
      section: row.section,
      section_path: row.section_path,
      vector_score: num(row.similarity),
      keyword_score: null,
      vector_rank: index + 1,
      keyword_rank: null,
      score: 1 / (RRF_K + index + 1),
    });
  });

  keywordRows.forEach((row, index) => {
    const existing = merged.get(row.chunk_index);
    const contribution = 1 / (RRF_K + index + 1);
    if (existing) {
      existing.keyword_score = num(row.rank);
      existing.keyword_rank = index + 1;
      existing.score += contribution;
      return;
    }
    merged.set(row.chunk_index, {
      chunk_index: row.chunk_index,
      content: row.content,
      page: row.page,
      page_end: row.page_end ?? row.page,
      section: row.section,
      section_path: row.section_path,
      vector_score: null,
      keyword_score: num(row.rank),
      vector_rank: null,
      keyword_rank: index + 1,
      score: contribution,
    });
  });

  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index)
    .slice(0, topK);
}

export async function countChunks(
  db: Queryable,
  paperId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: string | number }>(
    "SELECT count(*) AS n FROM public.paper_chunks WHERE paper_id = $1",
    [paperId],
  );
  return Number(rows[0]?.n ?? 0);
}
