/**
 * Paper ingestion and question answering.
 *
 * Orchestration only, with every dependency injected: the database, the science
 * service, the embedding client and the model client. The route wires the
 * production implementations; the tests wire an in-process Postgres and fakes,
 * which is what makes the whole pipeline verifiable without Supabase.
 *
 * Ingest:  bytes -> science /documents/chunk -> embed passages -> pgvector
 * Ask:     question -> embed query -> hybrid retrieve -> grounded answer
 */
import { createHash, randomUUID } from "node:crypto";
import {
  EMBEDDING_MODEL,
  embedPassages,
  embedQuery,
  type EmbeddingClient,
} from "../lib/embeddings";
import type { ModelClient } from "../agent/loop";
import { answerFromChunks, type HistoryTurn, type RagAnswer } from "./answer";
import {
  replaceChunks,
  retrieve,
  type ChunkInput,
  type Queryable,
  type RetrieveOptions,
} from "./store";

/** Chunk settings sent to the science service; recorded on the paper row. */
export interface ChunkConfig {
  target_chars?: number;
  max_chars?: number;
  overlap_chars?: number;
  max_pages?: number;
}

export interface ScienceChunk {
  chunk_index: number;
  content: string;
  page: number;
  page_end: number;
  section: string | null;
  section_path: string | null;
  section_index: number;
  char_count: number;
}

export interface ScienceChunkResponse {
  paper_id: string;
  title: string | null;
  page_count: number;
  pages_ingested: number;
  chunks: ScienceChunk[];
  stats: Record<string, number>;
  warnings: string[];
  sections: { index: number; path: string }[];
}

/** How the pipeline reaches the science service. Injected for tests. */
export type ChunkPdf = (
  paperId: string,
  pdfBase64: string,
  config: ChunkConfig,
) => Promise<ScienceChunkResponse>;

/** Optional object-storage upload. Returns the stored path. */
export type StorePdf = (path: string, bytes: Buffer) => Promise<void>;

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface IngestDeps {
  db: Queryable;
  chunkPdf: ChunkPdf;
  embeddings?: EmbeddingClient;
  storePdf?: StorePdf;
}

export interface IngestResult {
  paper_id: string;
  title: string;
  status: "ready";
  page_count: number;
  pages_ingested: number;
  chunk_count: number;
  sections: { index: number; path: string }[];
  stats: Record<string, number>;
  warnings: string[];
  embedding_model: string;
  chunk_config: ChunkConfig;
  storage_path: string;
  /** True when the same bytes were already ingested for this user. */
  deduplicated: boolean;
}

export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ingest a PDF for a user.
 *
 * Re-uploading identical bytes returns the existing paper instead of a
 * duplicate: the hash is the natural idempotency key for an upload, and Week 7's
 * explicit keys build on it.
 */
export async function ingestPaper(
  deps: IngestDeps,
  input: {
    userId: string;
    filename: string;
    bytes: Buffer;
    title?: string;
    chunkConfig?: ChunkConfig;
  },
): Promise<IngestResult> {
  const { db, chunkPdf } = deps;
  const embedder = deps.embeddings;
  const hash = contentHash(input.bytes);
  const chunkConfig = input.chunkConfig ?? {};

  const existing = await db.query<{
    id: string;
    title: string;
    page_count: number | null;
    chunk_count: number | null;
    warnings: unknown;
    storage_path: string;
  }>(
    `SELECT id, title, page_count, chunk_count, warnings, storage_path
       FROM public.papers
      WHERE user_id = $1 AND content_hash = $2 AND status = 'ready'
      LIMIT 1`,
    [input.userId, hash],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const sections = await db
      .query<{ index: number; path: string }>(
        `SELECT DISTINCT section_index AS index, section_path AS path
           FROM public.paper_chunks WHERE paper_id = $1 ORDER BY section_index`,
        [row.id],
      )
      .catch(() => ({ rows: [] as { index: number; path: string }[] }));
    return {
      paper_id: row.id,
      title: row.title,
      status: "ready",
      page_count: row.page_count ?? 0,
      pages_ingested: row.page_count ?? 0,
      chunk_count: row.chunk_count ?? 0,
      sections: sections.rows,
      stats: {},
      warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
      embedding_model: EMBEDDING_MODEL,
      chunk_config: chunkConfig,
      storage_path: row.storage_path,
      deduplicated: true,
    };
  }

  const paperId = randomUUID();
  const storagePath = `${input.userId}/${hash}.pdf`;
  const fallbackTitle =
    input.title?.trim() || input.filename.replace(/\.pdf$/i, "");

  await db.query(
    `INSERT INTO public.papers (id, user_id, title, storage_path, status, content_hash)
     VALUES ($1, $2, $3, $4, 'processing', $5)`,
    [paperId, input.userId, fallbackTitle, storagePath, hash],
  );

  try {
    // Object storage is best-effort: chunking reads the uploaded bytes directly,
    // so the pipeline does not depend on the upload succeeding. A failed upload
    // costs the ability to re-download the original, not the ability to answer.
    if (deps.storePdf) {
      try {
        await deps.storePdf(storagePath, input.bytes);
      } catch (err) {
        console.warn(`paper ${paperId}: storage upload failed:`, err);
      }
    }

    const extracted = await chunkPdf(
      paperId,
      input.bytes.toString("base64"),
      chunkConfig,
    );
    if (extracted.chunks.length === 0) {
      throw new IngestError("The PDF produced no chunks.", 422);
    }

    const vectors = embedder
      ? await embedPassages(
          extracted.chunks.map((c) => c.content),
          embedder,
        )
      : await embedPassages(extracted.chunks.map((c) => c.content));

    const chunkRows: ChunkInput[] = extracted.chunks.map((c) => ({
      chunk_index: c.chunk_index,
      content: c.content,
      page: c.page,
      page_end: c.page_end,
      section: c.section,
      section_path: c.section_path,
      section_index: c.section_index,
      char_count: c.char_count,
    }));
    const stored = await replaceChunks(db, paperId, chunkRows, vectors);

    const title = extracted.title?.trim() || fallbackTitle;
    await db.query(
      `UPDATE public.papers
          SET status = 'ready', title = $2, page_count = $3, chunk_count = $4,
              warnings = $5::jsonb, embedding_model = $6, chunk_config = $7::jsonb, error = NULL
        WHERE id = $1`,
      [
        paperId,
        title,
        extracted.page_count,
        stored,
        JSON.stringify(extracted.warnings ?? []),
        EMBEDDING_MODEL,
        JSON.stringify(chunkConfig),
      ],
    );

    return {
      paper_id: paperId,
      title,
      status: "ready",
      page_count: extracted.page_count,
      pages_ingested: extracted.pages_ingested,
      chunk_count: stored,
      sections: extracted.sections ?? [],
      stats: extracted.stats ?? {},
      warnings: extracted.warnings ?? [],
      embedding_model: EMBEDDING_MODEL,
      chunk_config: chunkConfig,
      storage_path: storagePath,
      deduplicated: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure on the row: a paper stuck in 'processing' with no
    // reason is the state that makes an ingestion bug invisible.
    await db
      .query(
        "UPDATE public.papers SET status = 'failed', error = $2 WHERE id = $1",
        [paperId, message.slice(0, 500)],
      )
      .catch(() => undefined);
    throw err instanceof IngestError ? err : new IngestError(message, 502);
  }
}

export interface AskDeps {
  db: Queryable;
  model: ModelClient;
  embeddings?: EmbeddingClient;
}

export interface AskResult extends RagAnswer {
  paper_id: string;
  thread_id: string;
  question: string;
  retrieval: { topK: number; hybrid: boolean; candidates: number };
}

/**
 * Answer a question about one paper, persisting the turn in its thread.
 *
 * The thread is per paper (migration 003): the product requirement is a
 * conversation held "within the context of that paper", and anchoring it makes
 * retrieval scope a foreign key rather than a convention.
 */
export async function askPaper(
  deps: AskDeps,
  input: {
    userId: string;
    paperId: string;
    question: string;
    threadId?: string;
    retrieval?: RetrieveOptions;
  },
): Promise<AskResult> {
  const { db, model } = deps;

  const paper = await db.query<{ id: string; title: string; status: string }>(
    "SELECT id, title, status FROM public.papers WHERE id = $1 AND user_id = $2",
    [input.paperId, input.userId],
  );
  if (paper.rows.length === 0) {
    throw new IngestError("Paper not found.", 404);
  }
  if (paper.rows[0].status !== "ready") {
    throw new IngestError(
      `Paper is '${paper.rows[0].status}', not ready for questions.`,
      409,
    );
  }

  const threadId = await ensureThread(
    db,
    input.paperId,
    input.userId,
    input.threadId,
  );
  const history = await loadHistory(db, threadId);

  const queryVector = deps.embeddings
    ? await embedQuery(input.question, deps.embeddings)
    : await embedQuery(input.question);

  const options = input.retrieval ?? {};
  const chunks = await retrieve(
    db,
    input.paperId,
    input.question,
    queryVector,
    options,
  );

  const answer = await answerFromChunks({
    question: input.question,
    paperTitle: paper.rows[0].title,
    chunks,
    history,
    client: model,
  });

  await db.query(
    "INSERT INTO public.paper_messages (thread_id, role, content) VALUES ($1, 'user', $2)",
    [threadId, input.question],
  );
  await db.query(
    `INSERT INTO public.paper_messages (thread_id, role, content, citations, outcome)
     VALUES ($1, 'assistant', $2, $3::jsonb, $4)`,
    [threadId, answer.answer, JSON.stringify(answer.citations), answer.outcome],
  );

  return {
    ...answer,
    paper_id: input.paperId,
    thread_id: threadId,
    question: input.question,
    retrieval: {
      topK: options.topK ?? 6,
      hybrid: options.hybrid ?? true,
      candidates: chunks.length,
    },
  };
}

async function ensureThread(
  db: Queryable,
  paperId: string,
  userId: string,
  threadId?: string,
): Promise<string> {
  if (threadId) {
    const found = await db.query<{ id: string }>(
      "SELECT id FROM public.paper_threads WHERE id = $1 AND paper_id = $2 AND user_id = $3",
      [threadId, paperId, userId],
    );
    if (found.rows.length > 0) return found.rows[0].id;
    throw new IngestError("Thread not found for this paper.", 404);
  }
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM public.paper_threads
      WHERE paper_id = $1 AND user_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [paperId, userId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await db.query<{ id: string }>(
    "INSERT INTO public.paper_threads (paper_id, user_id) VALUES ($1, $2) RETURNING id",
    [paperId, userId],
  );
  return created.rows[0].id;
}

async function loadHistory(
  db: Queryable,
  threadId: string,
): Promise<HistoryTurn[]> {
  const { rows } = await db.query<{
    role: "user" | "assistant";
    content: string;
  }>(
    `SELECT role, content FROM public.paper_messages
      WHERE thread_id = $1 ORDER BY created_at DESC, id DESC LIMIT 8`,
    [threadId],
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}
