/**
 * Embedding generation for the paper RAG pipeline.
 *
 * DECISION (ADR-006): `gemini-embedding-001` truncated to 768 dimensions and
 * re-normalised, not its native 3072. Measured reason: pgvector 0.8.0 refuses
 * to build either ANN index above 2000 dimensions ("column cannot have more
 * than 2000 dimensions for hnsw index"), so a 3072-dim column could only ever
 * be sequentially scanned — forfeiting the reason ADR-002 chose pgvector. 768
 * also cuts row width and distance cost fourfold, and the model is trained for
 * truncation.
 *
 * Truncated vectors come back un-normalised (measured L2 norm 0.594 at 768 vs
 * 1.000 at 3072), so they are re-normalised here. Cosine distance would cope
 * either way, but normalising keeps inner product and cosine interchangeable
 * and removes a footgun from any later index change.
 */
import { GoogleGenAI } from "@google/genai";
import { serverRetryDelayMs, withRetry } from "./retry";

export const EMBEDDING_MODEL: string =
  process.env.EMBEDDING_MODEL?.trim() || "gemini-embedding-001";

export const EMBEDDING_DIMENSIONS = 768;

/** Gemini accepts batched inputs; this bounds one request's size. */
const BATCH_SIZE = 32;

const EMBED_RETRIES = 2;

/**
 * Task types steer the model: a stored passage and a search query are embedded
 * for different purposes and the asymmetry measurably improves retrieval.
 */
export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export interface EmbeddingClient {
  embed(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}

let shared: GoogleGenAI | null = null;

function genai(): GoogleGenAI {
  if (!shared) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      console.warn("GEMINI_API_KEY is not set; embedding calls will fail.");
    shared = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }
  return shared;
}

const TRANSIENT =
  /\b(?:429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|fetch failed)\b/i;

/** Scale a vector to unit length; a zero vector is returned unchanged. */
export function normalize(values: number[]): number[] {
  let sumSquares = 0;
  for (const v of values) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (!Number.isFinite(norm) || norm === 0) return values;
  return values.map((v) => v / norm);
}

/** pgvector's text input format: '[0.1,0.2,...]'. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export const geminiEmbeddings: EmbeddingClient = {
  async embed(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = genai();
    const out: number[][] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const response = await withRetry(
        () =>
          client.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: batch,
            config: {
              taskType: task,
              outputDimensionality: EMBEDDING_DIMENSIONS,
            },
          }),
        {
          retries: EMBED_RETRIES,
          baseDelayMs: 500,
          maxDelayMs: 8000,
          shouldRetry: (err) =>
            TRANSIENT.test(err instanceof Error ? err.message : String(err)),
          delayFor: serverRetryDelayMs,
          onRetry: (err, attempt, delay) =>
            console.warn(
              `embedding batch attempt ${attempt + 1} failed (${err instanceof Error ? err.message : err}); retrying in ${delay} ms`,
            ),
        },
      );

      const vectors = response.embeddings ?? [];
      if (vectors.length !== batch.length) {
        throw new EmbeddingError(
          `embedding model returned ${vectors.length} vectors for ${batch.length} inputs`,
          false,
        );
      }
      for (const vector of vectors) {
        const values = vector.values ?? [];
        if (values.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}`,
            false,
          );
        }
        out.push(normalize(values));
      }
    }
    return out;
  },
};

/** Embed chunk text for storage. */
export function embedPassages(
  texts: string[],
  client: EmbeddingClient = geminiEmbeddings,
): Promise<number[][]> {
  return client.embed(texts, "RETRIEVAL_DOCUMENT");
}

/** Embed a user question for search. */
export async function embedQuery(
  text: string,
  client: EmbeddingClient = geminiEmbeddings,
): Promise<number[]> {
  const [vector] = await client.embed([text], "RETRIEVAL_QUERY");
  if (!vector)
    throw new EmbeddingError(
      "embedding model returned no vector for the query",
      false,
    );
  return vector;
}
