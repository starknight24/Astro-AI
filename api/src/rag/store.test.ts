/**
 * Retrieval tests against real pgvector (PGlite), not a mocked pool.
 *
 * That matters: the thing most likely to be wrong here is the SQL — operator
 * choice, index usage, `websearch_to_tsquery` behaviour on punctuation, the
 * `::vector` casts — and none of it is exercised by asserting on a mock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANDIDATE_POOL,
  DEFAULT_TOP_K,
  RRF_K,
  countChunks,
  replaceChunks,
  retrieve,
  type ChunkInput,
} from "./store";
import { createTestDb, fakeEmbedding, type TestDb } from "./testdb";
import { EMBEDDING_DIMENSIONS } from "../lib/embeddings";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

function chunk(
  index: number,
  content: string,
  overrides: Partial<ChunkInput> = {},
): ChunkInput {
  return {
    chunk_index: index,
    content,
    page: index + 1,
    page_end: index + 1,
    section: `${index + 1}. Section ${index + 1}`,
    section_path: `${index + 1}. Section ${index + 1}`,
    section_index: index + 1,
    char_count: content.length,
    ...overrides,
  };
}

/** Three chunks on three distinct embedding axes. */
async function seedThree(paperId = "p1") {
  const chunks = [
    chunk(
      0,
      "The satellite was placed into a Sun-synchronous orbit at 500 km.",
    ),
    chunk(
      1,
      "Atmospheric density was taken from the NRLMSISE-00 empirical model.",
    ),
    chunk(2, "The Hohmann transfer required two impulsive burns at apsides."),
  ];
  const embeddings = [
    fakeEmbedding(10),
    fakeEmbedding(200),
    fakeEmbedding(400),
  ];
  await replaceChunks(db, paperId, chunks, embeddings);
  return { chunks, embeddings };
}

describe("replaceChunks", () => {
  it("stores chunks with their citation metadata", async () => {
    await seedThree();
    expect(await countChunks(db, "p1")).toBe(3);
    const { rows } = await db.query<{ page: number; section: string }>(
      "SELECT page, section FROM public.paper_chunks WHERE paper_id = $1 ORDER BY chunk_index",
      ["p1"],
    );
    expect(rows.map((r) => r.page)).toEqual([1, 2, 3]);
    expect(rows[1].section).toBe("2. Section 2");
  });

  it("replaces an earlier ingestion rather than adding to it", async () => {
    await seedThree();
    await replaceChunks(
      db,
      "p1",
      [chunk(0, "Only one chunk now.")],
      [fakeEmbedding(10)],
    );
    expect(await countChunks(db, "p1")).toBe(1);
  });

  it("leaves other papers untouched", async () => {
    await seedThree("p1");
    await seedThree("p2");
    await replaceChunks(db, "p1", [], []);
    expect(await countChunks(db, "p1")).toBe(0);
    expect(await countChunks(db, "p2")).toBe(3);
  });

  it("rejects a chunk/embedding count mismatch", async () => {
    await expect(
      replaceChunks(
        db,
        "p1",
        [chunk(0, "a"), chunk(1, "b")],
        [fakeEmbedding(1)],
      ),
    ).rejects.toThrow(/mismatch/);
  });

  it("rejects an embedding of the wrong dimension", async () => {
    await expect(
      replaceChunks(db, "p1", [chunk(0, "a")], [[0.1, 0.2, 0.3]]),
    ).rejects.toThrow(/dimensions/);
  });

  it("stores a 768-dimension vector that pgvector accepts back", async () => {
    await seedThree();
    const { rows } = await db.query<{ dims: number }>(
      "SELECT vector_dims(embedding) AS dims FROM public.paper_chunks LIMIT 1",
    );
    expect(rows[0].dims).toBe(EMBEDDING_DIMENSIONS);
  });

  it("handles a paper with no chunks", async () => {
    expect(await replaceChunks(db, "empty", [], [])).toBe(0);
    expect(await countChunks(db, "empty")).toBe(0);
  });
});

describe("vector retrieval", () => {
  it("ranks the chunk nearest the query embedding first", async () => {
    await seedThree();
    const results = await retrieve(db, "p1", "", fakeEmbedding(200), {
      hybrid: false,
    });
    expect(results[0].chunk_index).toBe(1);
    expect(results[0].vector_score).toBeGreaterThan(0.9);
  });

  it("returns cosine similarity, not raw distance", async () => {
    await seedThree();
    const results = await retrieve(db, "p1", "", fakeEmbedding(10), {
      hybrid: false,
    });
    const best = results[0];
    expect(best.vector_score).toBeGreaterThan(0.99);
    expect(best.vector_score).toBeLessThanOrEqual(1);
    expect(results[results.length - 1].vector_score).toBeLessThan(
      best.vector_score!,
    );
  });

  it("scopes retrieval to one paper", async () => {
    await seedThree("p1");
    await replaceChunks(
      db,
      "p2",
      [chunk(0, "A completely different paper about exoplanet atmospheres.")],
      [fakeEmbedding(200)],
    );
    const results = await retrieve(db, "p1", "", fakeEmbedding(200), {
      hybrid: false,
    });
    expect(results.every((r) => !r.content.includes("exoplanet"))).toBe(true);
  });

  it("returns nothing for a paper with no chunks", async () => {
    expect(await retrieve(db, "missing", "anything", fakeEmbedding(1))).toEqual(
      [],
    );
  });

  it("ignores rows whose embedding is null", async () => {
    await seedThree();
    await db.query(
      "UPDATE public.paper_chunks SET embedding = NULL WHERE chunk_index = 1",
      [],
    );
    const results = await retrieve(db, "p1", "", fakeEmbedding(200), {
      hybrid: false,
    });
    expect(results.map((r) => r.chunk_index)).not.toContain(1);
  });

  it("honours topK", async () => {
    await seedThree();
    expect(
      await retrieve(db, "p1", "", fakeEmbedding(10), {
        hybrid: false,
        topK: 2,
      }),
    ).toHaveLength(2);
  });

  it("rejects a query embedding of the wrong dimension", async () => {
    await seedThree();
    await expect(retrieve(db, "p1", "q", [1, 2, 3])).rejects.toThrow(
      /dimensions/,
    );
  });
});

describe("keyword retrieval", () => {
  it("finds an exact identifier a dense vector would miss", async () => {
    // The point of hybrid: "NRLMSISE-00" carries no semantics, and the query
    // embedding here deliberately points at an unrelated axis.
    await seedThree();
    const results = await retrieve(db, "p1", "NRLMSISE-00", fakeEmbedding(400));
    expect(results[0].chunk_index).toBe(1);
    expect(results[0].keyword_score).toBeGreaterThan(0);
  });

  it("tolerates punctuation in a real question", async () => {
    await seedThree();
    const results = await retrieve(
      db,
      "p1",
      "What is the NRLMSISE-00 model?",
      fakeEmbedding(400),
    );
    expect(
      results.some((r) => r.chunk_index === 1 && r.keyword_rank !== null),
    ).toBe(true);
  });

  it("is skipped when hybrid is disabled", async () => {
    await seedThree();
    const results = await retrieve(
      db,
      "p1",
      "NRLMSISE-00",
      fakeEmbedding(400),
      { hybrid: false },
    );
    expect(results.every((r) => r.keyword_score === null)).toBe(true);
  });

  it("does not fail when no chunk matches the keywords", async () => {
    await seedThree();
    const results = await retrieve(
      db,
      "p1",
      "zygomorphic peristalsis",
      fakeEmbedding(10),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.keyword_score === null)).toBe(true);
  });

  it("stems English so a question's wording need not match the paper's", async () => {
    await replaceChunks(
      db,
      "p1",
      [chunk(0, "The orbit decayed rapidly during the solar maximum.")],
      [fakeEmbedding(10)],
    );
    const results = await retrieve(
      db,
      "p1",
      "orbital decay",
      fakeEmbedding(500),
    );
    expect(results[0].keyword_score).toBeGreaterThan(0);
  });
});

describe("reciprocal rank fusion", () => {
  it("scores a chunk found by both retrievers above one found by either alone", async () => {
    await seedThree();
    const results = await retrieve(
      db,
      "p1",
      "NRLMSISE-00 density model",
      fakeEmbedding(200),
    );
    const both = results.find((r) => r.chunk_index === 1)!;
    expect(both.vector_rank).not.toBeNull();
    expect(both.keyword_rank).not.toBeNull();
    expect(both.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 1), 10);
    expect(results[0].chunk_index).toBe(1);
  });

  it("uses rank, not raw score, so the two scales never need calibrating", async () => {
    await seedThree();
    const results = await retrieve(db, "p1", "", fakeEmbedding(10), {
      hybrid: false,
    });
    expect(results[0].score).toBeCloseTo(1 / (RRF_K + 1), 10);
    expect(results[1].score).toBeCloseTo(1 / (RRF_K + 2), 10);
  });

  it("includes a keyword-only hit in the fused results", async () => {
    await replaceChunks(
      db,
      "p1",
      [
        chunk(0, "Generic introductory prose about spaceflight history."),
        chunk(1, "The spacecraft identifier is NORAD ID 56205 throughout."),
      ],
      [fakeEmbedding(10), fakeEmbedding(600)],
    );
    const results = await retrieve(
      db,
      "p1",
      "NORAD ID 56205",
      fakeEmbedding(10),
      { topK: 2 },
    );
    const keywordOnly = results.find((r) => r.chunk_index === 1)!;
    expect(keywordOnly.keyword_rank).toBe(1);
    expect(keywordOnly.score).toBeGreaterThan(0);
  });

  it("breaks ties deterministically by chunk index", async () => {
    await replaceChunks(
      db,
      "p1",
      [chunk(0, "Identical text here."), chunk(1, "Identical text here.")],
      [fakeEmbedding(10), fakeEmbedding(10)],
    );
    const first = await retrieve(db, "p1", "", fakeEmbedding(10), {
      hybrid: false,
    });
    const second = await retrieve(db, "p1", "", fakeEmbedding(10), {
      hybrid: false,
    });
    expect(first.map((r) => r.chunk_index)).toEqual(
      second.map((r) => r.chunk_index),
    );
  });
});

describe("defaults", () => {
  it("retrieves DEFAULT_TOP_K chunks when the corpus is large enough", async () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      chunk(i, `Chunk number ${i} about orbits.`),
    );
    const embeddings = chunks.map((_, i) => fakeEmbedding(i * 7 + 1));
    await replaceChunks(db, "p1", chunks, embeddings);
    const results = await retrieve(db, "p1", "", fakeEmbedding(1), {
      hybrid: false,
    });
    expect(results).toHaveLength(DEFAULT_TOP_K);
  });

  it("draws candidates from a pool wider than topK before fusing", async () => {
    expect(CANDIDATE_POOL).toBeGreaterThan(DEFAULT_TOP_K);
  });
});
