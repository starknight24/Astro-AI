/**
 * Ingestion and question-answering, end to end against real Postgres+pgvector.
 *
 * The only fakes are the things that cost money or live outside the process: the
 * science service, the embedding model and the answering model. Everything
 * else — the SQL, the dedup logic, thread persistence, retrieval — is the real
 * code path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import type { ModelClient } from "../agent/loop";
import type { EmbeddingClient } from "../lib/embeddings";
import { REFUSAL_TEXT } from "./answer";
import {
  IngestError,
  askPaper,
  contentHash,
  ingestPaper,
  type ScienceChunk,
  type ScienceChunkResponse,
} from "./pipeline";
import { createTestDb, fakeEmbedding, type TestDb } from "./testdb";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

function scienceChunk(
  index: number,
  content: string,
  overrides: Partial<ScienceChunk> = {},
): ScienceChunk {
  return {
    chunk_index: index,
    content,
    page: index + 1,
    page_end: index + 1,
    section: `${index + 1}. Section`,
    section_path: `${index + 1}. Section`,
    section_index: index + 1,
    char_count: content.length,
    ...overrides,
  };
}

const CHUNKS = [
  scienceChunk(
    0,
    "The satellite was deployed into a Sun-synchronous orbit at 500 km altitude.",
  ),
  scienceChunk(
    1,
    "Atmospheric density came from the NRLMSISE-00 empirical model throughout.",
  ),
  scienceChunk(
    2,
    "The re-entry occurred 280 days after deployment, far short of the design life.",
  ),
];

function fakeScience(
  chunks: ScienceChunk[] = CHUNKS,
  overrides: Partial<ScienceChunkResponse> = {},
) {
  const calls: { paperId: string; config: unknown }[] = [];
  const fn = async (
    paperId: string,
    _b64: string,
    config: unknown,
  ): Promise<ScienceChunkResponse> => {
    calls.push({ paperId, config });
    return {
      paper_id: paperId,
      title: "Premature re-entry of the FACSAT-2 nanosatellite",
      page_count: 20,
      pages_ingested: 20,
      chunks,
      stats: { count: chunks.length },
      warnings: [],
      sections: chunks.map((c) => ({
        index: c.section_index,
        path: c.section_path ?? "",
      })),
      ...overrides,
    };
  };
  return Object.assign(fn, { calls });
}

/** Embeds by position so similarity ordering is predictable. */
function fakeEmbedder(axisFor?: (text: string) => number): EmbeddingClient {
  return {
    embed: async (texts) =>
      texts.map((text, i) =>
        fakeEmbedding(axisFor ? axisFor(text) : i * 100 + 10),
      ),
  };
}

function fakeModel(body: unknown): ModelClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    generate: async (request) => {
      calls.push(request);
      return {
        text: JSON.stringify(body),
        usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 60 },
      } as unknown as GenerateContentResponse;
    },
  };
}

const PDF = Buffer.from("%PDF-1.7 fake bytes for hashing");

async function ingest(
  overrides: Parameters<typeof ingestPaper>[1] | null = null,
) {
  return ingestPaper(
    { db, chunkPdf: fakeScience(), embeddings: fakeEmbedder() },
    overrides ?? { userId: USER, filename: "facsat2.pdf", bytes: PDF },
  );
}

// ---------- ingestion ----------

describe("ingestPaper", () => {
  it("stores the paper and its chunks and marks it ready", async () => {
    const result = await ingest();
    expect(result.status).toBe("ready");
    expect(result.chunk_count).toBe(3);
    expect(result.title).toBe(
      "Premature re-entry of the FACSAT-2 nanosatellite",
    );
    expect(result.deduplicated).toBe(false);

    const { rows } = await db.query<{
      status: string;
      chunk_count: number;
      embedding_model: string;
    }>(
      "SELECT status, chunk_count, embedding_model FROM public.papers WHERE id = $1",
      [result.paper_id],
    );
    expect(rows[0].status).toBe("ready");
    expect(rows[0].chunk_count).toBe(3);
    expect(rows[0].embedding_model).toBeTruthy();
  });

  it("records the section outline in document order", async () => {
    const chunks = [
      scienceChunk(0, "Intro text.", {
        section_path: "1. Introduction",
        section_index: 1,
      }),
      scienceChunk(1, "Appendix text.", {
        section_path: "10. Appendix",
        section_index: 10,
      }),
      scienceChunk(2, "Data text.", {
        section_path: "2. Data",
        section_index: 2,
      }),
    ];
    const result = await ingestPaper(
      { db, chunkPdf: fakeScience(chunks), embeddings: fakeEmbedder() },
      { userId: USER, filename: "p.pdf", bytes: PDF },
    );
    const { rows } = await db.query<{ path: string }>(
      `SELECT DISTINCT section_index, section_path AS path FROM public.paper_chunks
        WHERE paper_id = $1 ORDER BY section_index`,
      [result.paper_id],
    );
    // Document order, not lexical: "2. Data" before "10. Appendix".
    expect(rows.map((r) => r.path)).toEqual([
      "1. Introduction",
      "2. Data",
      "10. Appendix",
    ]);
  });

  it("stores the content hash so the same bytes are recognised", async () => {
    const result = await ingest();
    const { rows } = await db.query<{ content_hash: string }>(
      "SELECT content_hash FROM public.papers WHERE id = $1",
      [result.paper_id],
    );
    expect(rows[0].content_hash).toBe(contentHash(PDF));
  });

  it("returns the existing paper when the same file is uploaded twice", async () => {
    const first = await ingest();
    const second = await ingest();
    expect(second.deduplicated).toBe(true);
    expect(second.paper_id).toBe(first.paper_id);
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM public.papers",
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("does not deduplicate across users", async () => {
    await ingest();
    const other = await ingestPaper(
      { db, chunkPdf: fakeScience(), embeddings: fakeEmbedder() },
      { userId: OTHER_USER, filename: "facsat2.pdf", bytes: PDF },
    );
    expect(other.deduplicated).toBe(false);
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM public.papers",
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it("re-ingesting with a different chunk size replaces the old chunks", async () => {
    const first = await ingest();
    const fewer = [scienceChunk(0, "One big chunk now covering everything.")];
    await db.query("DELETE FROM public.papers WHERE id = $1", [first.paper_id]);
    const second = await ingestPaper(
      { db, chunkPdf: fakeScience(fewer), embeddings: fakeEmbedder() },
      {
        userId: USER,
        filename: "facsat2.pdf",
        bytes: PDF,
        chunkConfig: { target_chars: 4000 },
      },
    );
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM public.paper_chunks WHERE paper_id = $1",
      [second.paper_id],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("passes the chunk configuration through to the science service and records it", async () => {
    const science = fakeScience();
    const result = await ingestPaper(
      { db, chunkPdf: science, embeddings: fakeEmbedder() },
      {
        userId: USER,
        filename: "p.pdf",
        bytes: PDF,
        chunkConfig: { target_chars: 900, overlap_chars: 0 },
      },
    );
    expect(science.calls[0].config).toMatchObject({
      target_chars: 900,
      overlap_chars: 0,
    });
    const { rows } = await db.query<{ chunk_config: { target_chars: number } }>(
      "SELECT chunk_config FROM public.papers WHERE id = $1",
      [result.paper_id],
    );
    expect(rows[0].chunk_config.target_chars).toBe(900);
  });

  it("surfaces extraction warnings instead of swallowing them", async () => {
    const result = await ingestPaper(
      {
        db,
        chunkPdf: fakeScience(CHUNKS, {
          warnings: ["3 of 20 pages yielded no text"],
        }),
        embeddings: fakeEmbedder(),
      },
      { userId: USER, filename: "p.pdf", bytes: PDF },
    );
    expect(result.warnings).toEqual(["3 of 20 pages yielded no text"]);
    const { rows } = await db.query<{ warnings: string[] }>(
      "SELECT warnings FROM public.papers WHERE id = $1",
      [result.paper_id],
    );
    expect(rows[0].warnings).toEqual(["3 of 20 pages yielded no text"]);
  });

  it("falls back to the filename when the PDF has no title", async () => {
    const result = await ingestPaper(
      {
        db,
        chunkPdf: fakeScience(CHUNKS, { title: null }),
        embeddings: fakeEmbedder(),
      },
      { userId: USER, filename: "my-paper.pdf", bytes: PDF },
    );
    expect(result.title).toBe("my-paper");
  });

  it("marks the paper failed with a reason when extraction fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = async () => {
      throw new IngestError("The PDF is probably a scan.", 422);
    };
    await expect(
      ingestPaper(
        { db, chunkPdf: failing, embeddings: fakeEmbedder() },
        {
          userId: USER,
          filename: "scan.pdf",
          bytes: PDF,
        },
      ),
    ).rejects.toThrow(/scan/);

    const { rows } = await db.query<{ status: string; error: string }>(
      "SELECT status, error FROM public.papers WHERE user_id = $1",
      [USER],
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("scan");
  });

  it("rejects a document that produced no chunks", async () => {
    await expect(
      ingestPaper(
        { db, chunkPdf: fakeScience([]), embeddings: fakeEmbedder() },
        {
          userId: USER,
          filename: "p.pdf",
          bytes: PDF,
        },
      ),
    ).rejects.toThrow(/no chunks/);
  });

  it("succeeds when the optional storage upload fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await ingestPaper(
      {
        db,
        chunkPdf: fakeScience(),
        embeddings: fakeEmbedder(),
        storePdf: async () => {
          throw new Error("bucket not found");
        },
      },
      { userId: USER, filename: "p.pdf", bytes: PDF },
    );
    expect(result.status).toBe("ready");
    expect(result.chunk_count).toBe(3);
  });

  it("uploads to storage when a putter is configured", async () => {
    const uploads: string[] = [];
    const result = await ingestPaper(
      {
        db,
        chunkPdf: fakeScience(),
        embeddings: fakeEmbedder(),
        storePdf: async (path) => void uploads.push(path),
      },
      { userId: USER, filename: "p.pdf", bytes: PDF },
    );
    expect(uploads).toEqual([result.storage_path]);
    expect(result.storage_path).toContain(USER);
  });
});

// ---------- asking ----------

const GROUNDED = {
  supported: true,
  answer: "The re-entry happened 280 days after deployment.",
  citations: [
    {
      chunk_index: 2,
      page: 3,
      quote: "The re-entry occurred 280 days after deployment",
    },
  ],
  missing: "",
};

const UNSUPPORTED = {
  supported: false,
  answer: "",
  citations: [],
  missing: "The paper does not report the launch vehicle's cost.",
};

describe("askPaper", () => {
  it("answers with verified page citations", async () => {
    const paper = await ingest();
    const result = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "When did it re-enter?",
      },
    );
    expect(result.outcome).toBe("answered");
    expect(result.citations[0].page).toBe(3);
    expect(result.citations[0].chunk_index).toBe(2);
  });

  it("refuses rather than inventing when the paper cannot answer", async () => {
    const paper = await ingest();
    const result = await askPaper(
      {
        db,
        model: fakeModel(UNSUPPORTED),
        embeddings: fakeEmbedder(() => 200),
      },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "What did the launch cost?",
      },
    );
    expect(result.outcome).toBe("refused_unsupported");
    expect(result.answer).toBe(REFUSAL_TEXT);
    expect(result.citations).toEqual([]);
  });

  it("persists both turns in a thread anchored to the paper", async () => {
    const paper = await ingest();
    const result = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "When did it re-enter?",
      },
    );
    const { rows } = await db.query<{
      role: string;
      outcome: string;
      content: string;
    }>(
      "SELECT role, outcome, content FROM public.paper_messages WHERE thread_id = $1 ORDER BY role",
      [result.thread_id],
    );
    expect(rows.map((r) => r.role)).toEqual(["assistant", "user"]);
    expect(rows.find((r) => r.role === "assistant")?.outcome).toBe("answered");
  });

  it("stores the citations with the assistant turn so they can be re-checked", async () => {
    const paper = await ingest();
    const result = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      { userId: USER, paperId: paper.paper_id, question: "When?" },
    );
    const { rows } = await db.query<{ citations: { page: number }[] }>(
      "SELECT citations FROM public.paper_messages WHERE thread_id = $1 AND role = 'assistant'",
      [result.thread_id],
    );
    expect(rows[0].citations[0].page).toBe(3);
  });

  it("continues the same thread across questions", async () => {
    const paper = await ingest();
    const first = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "When did it re-enter?",
      },
    );
    const second = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      { userId: USER, paperId: paper.paper_id, question: "And why?" },
    );
    expect(second.thread_id).toBe(first.thread_id);
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM public.paper_messages WHERE thread_id = $1",
      [first.thread_id],
    );
    expect(Number(rows[0].n)).toBe(4);
  });

  it("passes earlier turns to the model as context", async () => {
    const paper = await ingest();
    const model = fakeModel(GROUNDED);
    await askPaper(
      { db, model, embeddings: fakeEmbedder(() => 200) },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "When did it re-enter?",
      },
    );
    const second = fakeModel(GROUNDED);
    await askPaper(
      { db, model: second, embeddings: fakeEmbedder(() => 200) },
      { userId: USER, paperId: paper.paper_id, question: "And why?" },
    );
    expect(JSON.stringify(second.calls[0])).toContain("When did it re-enter?");
  });

  it("refuses to answer about another user's paper", async () => {
    const paper = await ingest();
    await expect(
      askPaper(
        { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
        { userId: OTHER_USER, paperId: paper.paper_id, question: "When?" },
      ),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a question about a paper that is still processing", async () => {
    const paper = await ingest();
    await db.query(
      "UPDATE public.papers SET status = 'processing' WHERE id = $1",
      [paper.paper_id],
    );
    await expect(
      askPaper(
        { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
        { userId: USER, paperId: paper.paper_id, question: "When?" },
      ),
    ).rejects.toThrow(/not ready/);
  });

  it("rejects a thread id belonging to a different paper", async () => {
    const paper = await ingest();
    await expect(
      askPaper(
        { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
        {
          userId: USER,
          paperId: paper.paper_id,
          question: "When?",
          threadId: "33333333-3333-4333-8333-333333333333",
        },
      ),
    ).rejects.toThrow(/Thread not found/);
  });

  it("reports the retrieval settings it used", async () => {
    const paper = await ingest();
    const result = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 200) },
      {
        userId: USER,
        paperId: paper.paper_id,
        question: "When?",
        retrieval: { topK: 2, hybrid: false },
      },
    );
    expect(result.retrieval).toEqual({ topK: 2, hybrid: false, candidates: 2 });
  });

  it("retrieves the chunk whose text matches an exact identifier", async () => {
    const paper = await ingest();
    // Query embedding deliberately points away from the NRLMSISE chunk, so only
    // keyword matching can surface it.
    const result = await askPaper(
      { db, model: fakeModel(GROUNDED), embeddings: fakeEmbedder(() => 999) },
      { userId: USER, paperId: paper.paper_id, question: "NRLMSISE-00" },
    );
    expect(result.context.some((c) => c.chunk_index === 1)).toBe(true);
  });
});
