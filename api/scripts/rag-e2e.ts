/**
 * End-to-end RAG check against a real PDF, the real science service, real
 * embeddings and a real model — with an in-process Postgres standing in for
 * Supabase.
 *
 *   npx tsx scripts/rag-e2e.ts ../path/to/paper.pdf "question one" "question two"
 *
 * Exists because the Week-5 exit criterion is a behaviour, not a unit test:
 * upload a paper, ask questions, get page-cited answers, ask something the
 * paper cannot answer, get a refusal. This script is that check, runnable.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { ModelClient } from "../src/agent/loop";
import { EMBEDDING_MODEL, geminiEmbeddings } from "../src/lib/embeddings";
import { postToScience } from "../src/lib/scienceClient";
import { RAG_MODEL } from "../src/rag/answer";
import {
  askPaper,
  ingestPaper,
  type ChunkConfig,
  type ScienceChunkResponse,
} from "../src/rag/pipeline";
import { createTestDb } from "../src/rag/testdb";

const USER = "11111111-1111-4111-8111-111111111111";

const SCIENCE_BASE = (
  process.env.SCIENCE_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

async function chunkPdf(
  paperId: string,
  pdfBase64: string,
  config: ChunkConfig,
): Promise<ScienceChunkResponse> {
  const outcome = await postToScience(SCIENCE_BASE, "/documents/chunk", {
    paper_id: paperId,
    pdf_base64: pdfBase64,
    ...config,
  });
  if (outcome.kind === "network")
    throw new Error(`science unreachable: ${outcome.message}`);
  if (outcome.status !== 200)
    throw new Error(
      `science responded ${outcome.status}: ${JSON.stringify(outcome.body).slice(0, 300)}`,
    );
  return outcome.body as ScienceChunkResponse;
}

function modelClient(): ModelClient {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? "MOCK_KEY",
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
  return { generate: (request) => ai.models.generateContent(request) };
}

async function main(): Promise<void> {
  const [pdfPath, ...questions] = process.argv.slice(2);
  if (!pdfPath || questions.length === 0) {
    console.error(
      'usage: tsx scripts/rag-e2e.ts <paper.pdf> "question" ["question" ...]',
    );
    process.exit(2);
  }

  const bytes = readFileSync(pdfPath);
  const db = await createTestDb();
  const model = modelClient();

  console.log("=".repeat(78));
  console.log(
    `PDF        : ${path.basename(pdfPath)} (${(bytes.length / 1024).toFixed(0)} KB)`,
  );
  console.log(`embeddings : ${EMBEDDING_MODEL}`);
  console.log(`answerer   : ${RAG_MODEL}`);
  console.log("=".repeat(78));

  const t0 = Date.now();
  const paper = await ingestPaper(
    { db, chunkPdf, embeddings: geminiEmbeddings },
    { userId: USER, filename: path.basename(pdfPath), bytes },
  );
  console.log(
    `\n--- INGESTED in ${((Date.now() - t0) / 1000).toFixed(1)}s ---`,
  );
  console.log(`title      : ${paper.title}`);
  console.log(
    `pages      : ${paper.page_count}  chunks: ${paper.chunk_count}  sections: ${paper.sections.length}`,
  );
  console.log(`chunk stats: ${JSON.stringify(paper.stats)}`);
  if (paper.warnings.length)
    console.log(`warnings   : ${paper.warnings.join(" | ")}`);

  let answered = 0;
  let refused = 0;

  for (const question of questions) {
    const started = Date.now();
    const result = await askPaper(
      { db, model, embeddings: geminiEmbeddings },
      {
        userId: USER,
        paperId: paper.paper_id,
        question,
      },
    );
    console.log("\n" + "-".repeat(78));
    console.log(`Q: ${question}`);
    console.log(
      `   outcome=${result.outcome}  ${((Date.now() - started) / 1000).toFixed(1)}s  tokens=${result.tokens_in}/${result.tokens_out}`,
    );
    console.log(`A: ${result.answer}`);
    if (result.citations.length) {
      console.log("   citations:");
      for (const c of result.citations) {
        console.log(
          `     p.${c.page}  [${c.section ?? "-"}]  "${c.quote.slice(0, 110)}"`,
        );
      }
    }
    if (result.missing) console.log(`   missing: ${result.missing}`);
    if (result.rejected_citations.length) {
      console.log(
        `   REJECTED citations: ${JSON.stringify(result.rejected_citations)}`,
      );
    }
    console.log(
      `   retrieved: ${result.context
        .map((c) => `#${c.chunk_index}(p${c.page},s=${c.score.toFixed(4)})`)
        .join(" ")}`,
    );
    if (result.outcome === "answered") answered += 1;
    if (result.outcome === "refused_unsupported") refused += 1;
  }

  console.log("\n" + "=".repeat(78));
  console.log(
    `answered: ${answered}   refused: ${refused}   of ${questions.length} questions`,
  );
  await db.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
