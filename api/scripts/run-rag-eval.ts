/**
 * RAG eval runner.
 *
 *   npx tsx scripts/run-rag-eval.ts --retrieval-only          # no generateContent at all
 *   npx tsx scripts/run-rag-eval.ts --retrieval-only --no-hybrid
 *   npx tsx scripts/run-rag-eval.ts --limit 6                 # + answers + judge
 *   npx tsx scripts/run-rag-eval.ts --top-k 3 --retrieval-only
 *
 * Measures three things, deliberately separable:
 *
 *   retrieval hit-rate   is a gold page among the pages the retriever returned?
 *                        Needs embeddings only — no answer generation, no judge.
 *   refusal rate         do the unanswerable cases get refused?
 *   faithfulness /       LLM judge, versioned prompt (judge-v1).
 *   citation correctness
 *
 * `--retrieval-only` exists because retrieval quality is the variable worth
 * experimenting on and it costs no `generateContent` quota, which on this
 * project's free tier is the binding constraint (ADR-007).
 *
 * Papers are ingested into an in-process Postgres (PGlite + pgvector), so a run
 * is self-contained and repeatable and never touches production data.
 */
import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { ModelClient } from "../src/agent/loop";
import { EMBEDDING_MODEL, geminiEmbeddings } from "../src/lib/embeddings";
import { postToScience } from "../src/lib/scienceClient";
import { RAG_MODEL, RAG_PROMPT_VERSION } from "../src/rag/answer";
import {
  JUDGE_MODEL,
  JUDGE_PROMPT_VERSION,
  judgeAnswer,
} from "../src/rag/judge";
import {
  askPaper,
  ingestPaper,
  type ChunkConfig,
  type ScienceChunkResponse,
} from "../src/rag/pipeline";
import { retrieve } from "../src/rag/store";
import { embedQuery } from "../src/lib/embeddings";
import { createTestDb, type TestDb } from "../src/rag/testdb";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DATASET = path.join(REPO_ROOT, "evals", "datasets", "rag_golden.json");
const RESULTS_DIR = path.join(REPO_ROOT, "evals", "results");
const PAPERS_DIR =
  process.env.EVAL_PAPERS_DIR ?? path.join(REPO_ROOT, "evals", "papers");

const USER = "11111111-1111-4111-8111-111111111111";
const SCIENCE_BASE = (
  process.env.SCIENCE_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

/**
 * Gemini reports a per-minute and a per-day cap through the same 429. A per-day
 * cap is terminal: continuing costs a 59-second wait per remaining case and
 * produces nothing. Observed doing exactly that for eight cases in a row.
 */
const DAILY_LIMIT = /PerDay|RequestsPerDay/i;

interface GoldCase {
  id: string;
  paper: string;
  question: string;
  answerable: boolean;
  gold_pages: number[];
  gold_answer: string | null;
  gold_section: string | null;
  kind: string;
  difficulty: string;
}

interface Dataset {
  papers: Record<string, { arxiv_id: string; pages: number; title: string }>;
  cases: GoldCase[];
}

interface CaseResult {
  id: string;
  paper: string;
  question: string;
  answerable: boolean;
  gold_pages: number[];
  kind: string;
  difficulty: string;
  retrieved_pages: number[];
  retrieved_chunks: number[];
  retrieval_hit: boolean | null;
  /** 1-based position of the first gold page in the ranking, if present. */
  gold_rank: number | null;
  outcome?: string;
  answer?: string;
  cited_pages?: number[];
  cited_pages_correct?: boolean | null;
  rejected_citations?: number;
  refusal_correct?: boolean | null;
  /** True when the model could not be reached, so the case was not graded. */
  answer_error?: boolean;
  answer_error_cause?: string;
  faithful?: boolean | null;
  citations_correct?: boolean | null;
  answers_the_question?: boolean | null;
  judge_notes?: string;
  judge_error?: string;
  duration_ms?: number;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

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
  if (outcome.status !== 200) {
    throw new Error(
      `science responded ${outcome.status}: ${JSON.stringify(outcome.body).slice(0, 200)}`,
    );
  }
  return outcome.body as ScienceChunkResponse;
}

function modelClient(): ModelClient {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? "MOCK_KEY",
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
  return { generate: (request) => ai.models.generateContent(request) };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    retrievalOnly: flag("retrieval-only"),
    hybrid: !flag("no-hybrid"),
    topK: value("top-k") ? Number(value("top-k")) : 6,
    limit: value("limit") ? Number(value("limit")) : undefined,
    chunkTarget: value("chunk-target")
      ? Number(value("chunk-target"))
      : undefined,
    label: value("label"),
    out: value("out"),
  };
}

/**
 * Take `size` cases spread across papers AND across answerable/unanswerable.
 *
 * Taking the first N is biased by dataset order: the first eight cases are all
 * answerable questions about one paper, which produced a meaningless
 * "refusal accuracy 100% (0/0)". Deterministic round-robin so a subset run is
 * reproducible, matching the physics runner's approach.
 */
function stratifiedSubset(cases: GoldCase[], size: number): GoldCase[] {
  const buckets = new Map<string, GoldCase[]>();
  for (const c of cases) {
    // Bucket by paper AND answerability, so both are represented.
    const key = `${c.paper}:${c.answerable ? "answerable" : "unanswerable"}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(c);
    else buckets.set(key, [c]);
  }
  for (const bucket of buckets.values())
    bucket.sort((a, b) => a.id.localeCompare(b.id));

  const keys = [...buckets.keys()].sort();
  const chosen: GoldCase[] = [];
  let index = 0;
  while (chosen.length < size && keys.some((k) => buckets.get(k)!.length > 0)) {
    const bucket = buckets.get(keys[index % keys.length])!;
    const next = bucket.shift();
    if (next) chosen.push(next);
    index += 1;
  }
  return chosen.sort((a, b) => a.id.localeCompare(b.id));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataset = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;

  const missing = Object.entries(dataset.papers)
    .map(([id, meta]) => ({
      id,
      file: path.join(PAPERS_DIR, `${meta.arxiv_id}.pdf`),
    }))
    .filter((p) => !existsSync(p.file));
  if (missing.length > 0) {
    console.error(
      `missing PDFs in ${PAPERS_DIR}:\n` +
        missing.map((m) => `  ${path.basename(m.file)}`).join("\n") +
        `\n\nThe eval papers are not committed (they are third-party PDFs). Download them with:\n` +
        Object.values(dataset.papers)
          .map(
            (m) =>
              `  curl -sL -o "${PAPERS_DIR}/${m.arxiv_id}.pdf" "https://arxiv.org/pdf/${m.arxiv_id}"`,
          )
          .join("\n") +
        `\nor set EVAL_PAPERS_DIR to a directory that already has them.`,
    );
    process.exit(2);
  }

  const db: TestDb = await createTestDb();
  const model = modelClient();
  const started = new Date();
  const chunkConfig: ChunkConfig = args.chunkTarget
    ? { target_chars: args.chunkTarget }
    : {};

  console.log("=".repeat(76));
  console.log(`RAG EVAL  ${started.toISOString()}`);
  console.log(
    `retrieval: ${args.hybrid ? "hybrid" : "vector-only"}  top_k=${args.topK}` +
      (args.chunkTarget ? `  chunk_target=${args.chunkTarget}` : "") +
      `  embeddings=${EMBEDDING_MODEL}`,
  );
  console.log(
    args.retrievalOnly
      ? "mode: retrieval-only (no answer generation, no judge)"
      : `mode: full  answerer=${RAG_MODEL} (${RAG_PROMPT_VERSION})  judge=${JUDGE_MODEL} (${JUDGE_PROMPT_VERSION})`,
  );
  console.log("=".repeat(76));

  // ---- ingest the papers once ----
  const paperIds = new Map<string, string>();
  for (const [slug, meta] of Object.entries(dataset.papers)) {
    const file = path.join(PAPERS_DIR, `${meta.arxiv_id}.pdf`);
    const bytes = readFileSync(file);
    const result = await ingestPaper(
      { db, chunkPdf, embeddings: geminiEmbeddings },
      { userId: USER, filename: path.basename(file), bytes, chunkConfig },
    );
    paperIds.set(slug, result.paper_id);
    console.log(
      `ingested ${slug.padEnd(12)} ${result.page_count}p -> ${result.chunk_count} chunks, ${result.sections.length} sections`,
    );
  }

  const cases = args.limit
    ? stratifiedSubset(dataset.cases, args.limit)
    : dataset.cases;
  console.log(`\nrunning ${cases.length} case(s)\n`);

  const rows: CaseResult[] = [];
  for (const [index, gold] of cases.entries()) {
    const paperId = paperIds.get(gold.paper);
    if (!paperId) throw new Error(`unknown paper slug '${gold.paper}'`);

    const row: CaseResult = {
      id: gold.id,
      paper: gold.paper,
      question: gold.question,
      answerable: gold.answerable,
      gold_pages: gold.gold_pages,
      kind: gold.kind,
      difficulty: gold.difficulty,
      retrieved_pages: [],
      retrieved_chunks: [],
      retrieval_hit: null,
      gold_rank: null,
    };

    const queryVector = await embedQuery(gold.question, geminiEmbeddings);
    const chunks = await retrieve(db, paperId, gold.question, queryVector, {
      topK: args.topK,
      hybrid: args.hybrid,
    });

    // A chunk may span pages, so a gold page counts as retrieved if it falls
    // anywhere in a returned chunk's range.
    const pagesCovered = chunks.flatMap((c) => {
      const span: number[] = [];
      for (let p = c.page; p <= c.page_end; p++) span.push(p);
      return span;
    });
    row.retrieved_pages = [...new Set(pagesCovered)].sort((a, b) => a - b);
    row.retrieved_chunks = chunks.map((c) => c.chunk_index);

    if (gold.answerable) {
      row.retrieval_hit = gold.gold_pages.some((page) =>
        pagesCovered.includes(page),
      );
      const rank = chunks.findIndex((c) =>
        gold.gold_pages.some((page) => page >= c.page && page <= c.page_end),
      );
      row.gold_rank = rank >= 0 ? rank + 1 : null;
    }

    if (!args.retrievalOnly) {
      const answer = await askPaper(
        { db, model, embeddings: geminiEmbeddings },
        {
          userId: USER,
          paperId,
          question: gold.question,
          retrieval: { topK: args.topK, hybrid: args.hybrid },
        },
      );
      row.outcome = answer.outcome;
      row.answer = answer.answer;
      row.cited_pages = answer.citations.map((c) => c.page);
      row.rejected_citations = answer.rejected_citations.length;
      row.duration_ms = answer.duration_ms;
      row.tokens_in = answer.tokens_in;
      row.tokens_out = answer.tokens_out;

      // An `error` outcome means the model could not be reached, so there is no
      // answer to grade. Scoring it as "correctly did not refuse" would credit
      // an outage as a pass — the same mistake the physics runner made before
      // ADR-007 §9 was applied there.
      if (answer.outcome === "error") {
        row.refusal_correct = null;
        row.cited_pages_correct = null;
        row.answer_error = true;
        row.answer_error_cause = answer.error ?? "unknown";
      } else {
        // Refusal is correct when the paper genuinely cannot answer, and wrong
        // when it can. Measured directly, not via the judge.
        row.refusal_correct = gold.answerable
          ? answer.outcome !== "refused_unsupported"
          : answer.outcome === "refused_unsupported";

        // Deterministic check alongside the judge: did it cite a gold page?
        row.cited_pages_correct = gold.answerable
          ? answer.citations.some((c) => gold.gold_pages.includes(c.page))
          : null;
      }

      if (answer.outcome === "answered") {
        const verdict = await judgeAnswer({
          question: gold.question,
          answer: answer.answer,
          citations: answer.citations,
          chunks: answer.context.map((c) => ({
            chunk_index: c.chunk_index,
            content:
              chunks.find((k) => k.chunk_index === c.chunk_index)?.content ??
              "",
            page: c.page,
            page_end: c.page_end,
            section: c.section,
            section_path: null,
            vector_score: null,
            keyword_score: null,
            vector_rank: null,
            keyword_rank: null,
            score: c.score,
          })),
          client: model,
        });
        row.faithful = verdict.error ? null : verdict.faithful;
        row.citations_correct = verdict.error
          ? null
          : verdict.citations_correct;
        row.answers_the_question = verdict.error
          ? null
          : verdict.answers_the_question;
        row.judge_notes = [verdict.faithfulness_reason, verdict.citation_reason]
          .filter(Boolean)
          .join(" | ");
        if (verdict.error) row.judge_error = verdict.error;
      }
    }

    rows.push(row);
    const hit = gold.answerable
      ? row.retrieval_hit
        ? "HIT "
        : "MISS"
      : "n/a ";
    const extra = args.retrievalOnly
      ? ""
      : `  ${row.outcome}  refusal=${row.refusal_correct ? "ok" : "WRONG"}` +
        (row.faithful === null || row.faithful === undefined
          ? ""
          : `  faithful=${row.faithful}`);
    console.log(
      `  [${index + 1}/${cases.length}] ${gold.id} ${hit} rank=${row.gold_rank ?? "-"}` +
        `  gold=${JSON.stringify(gold.gold_pages)} got=${JSON.stringify(row.retrieved_pages)}${extra}`,
    );

    if (row.answer_error_cause && DAILY_LIMIT.test(row.answer_error_cause)) {
      console.error(
        `\nstopping at ${gold.id}: this model's PER-DAY request cap was reached. ` +
          `Retrieval metrics below cover the cases that ran; answer metrics are incomplete.`,
      );
      break;
    }
  }

  await db.close();

  // ---- metrics ----
  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const hits = answerable.filter((r) => r.retrieval_hit).length;
  const ranks = answerable
    .map((r) => r.gold_rank)
    .filter((r): r is number => r !== null);

  const judged = rows.filter(
    (r) => r.faithful !== null && r.faithful !== undefined,
  );
  const refusalRows = rows.filter(
    (r) => r.refusal_correct !== null && r.refusal_correct !== undefined,
  );

  const summary = {
    cases: rows.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    retrieval_hit_rate: answerable.length
      ? Number((hits / answerable.length).toFixed(4))
      : null,
    retrieval_hits: hits,
    // Mean reciprocal rank: rewards putting the gold page first, not just in
    // the list. A hit-rate alone cannot distinguish rank 1 from rank 6.
    mrr: ranks.length
      ? Number(
          (
            ranks.reduce((sum, r) => sum + 1 / r, 0) / answerable.length
          ).toFixed(4),
        )
      : null,
    gold_rank_1: answerable.filter((r) => r.gold_rank === 1).length,
    refusal_accuracy: refusalRows.length
      ? Number(
          (
            refusalRows.filter((r) => r.refusal_correct).length /
            refusalRows.length
          ).toFixed(4),
        )
      : null,
    // Reported separately: a run whose sample contains no unanswerable cases
    // cannot say anything about refusal behaviour, and printing "100% (0/0)"
    // invites reading it as a result.
    refusal_measurable: unanswerable.length > 0,
    correct_refusals: unanswerable.filter((r) => r.refusal_correct).length,
    cited_gold_page: answerable.filter((r) => r.cited_pages_correct).length,
    faithfulness: judged.length
      ? Number(
          (judged.filter((r) => r.faithful).length / judged.length).toFixed(4),
        )
      : null,
    citation_correctness: judged.length
      ? Number(
          (
            judged.filter((r) => r.citations_correct).length / judged.length
          ).toFixed(4),
        )
      : null,
    judged: judged.length,
    judge_errors: rows.filter((r) => r.judge_error).length,
    verified_citation_rejections: rows.reduce(
      (sum, r) => sum + (r.rejected_citations ?? 0),
      0,
    ),
    tokens_in: rows.reduce((sum, r) => sum + (r.tokens_in ?? 0), 0),
    tokens_out: rows.reduce((sum, r) => sum + (r.tokens_out ?? 0), 0),
  };

  const payload = {
    run: {
      label: args.label ?? null,
      started_at: started.toISOString(),
      finished_at: new Date().toISOString(),
      mode: args.retrievalOnly ? "retrieval-only" : "full",
      retrieval: {
        hybrid: args.hybrid,
        top_k: args.topK,
        chunk_target: args.chunkTarget ?? null,
      },
      embedding_model: EMBEDDING_MODEL,
      answerer_model: args.retrievalOnly ? null : RAG_MODEL,
      answerer_prompt: args.retrievalOnly ? null : RAG_PROMPT_VERSION,
      judge_model: args.retrievalOnly ? null : JUDGE_MODEL,
      judge_prompt: args.retrievalOnly ? null : JUDGE_PROMPT_VERSION,
      dataset: path.basename(DATASET),
      cases: rows.length,
    },
    summary,
    results: rows,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const out = args.out ?? path.join(RESULTS_DIR, `rag-${stamp}Z.json`);
  writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);

  console.log("\n" + "=".repeat(76));
  console.log(
    `Retrieval hit-rate : ${pct(summary.retrieval_hit_rate)}  (${summary.retrieval_hits}/${summary.answerable} answerable)`,
  );
  console.log(
    `Gold page at rank 1: ${summary.gold_rank_1}/${summary.answerable}   MRR: ${summary.mrr ?? "-"}`,
  );
  if (!args.retrievalOnly) {
    console.log(
      summary.refusal_measurable
        ? `Refusal accuracy   : ${pct(summary.refusal_accuracy)}  (${summary.correct_refusals}/${summary.unanswerable} unanswerable refused)`
        : "Refusal accuracy   : not measured (no unanswerable cases in this sample)",
    );
    console.log(
      `Faithfulness       : ${pct(summary.faithfulness)}  (judge, ${summary.judged} answers)`,
    );
    console.log(
      `Citation correct.  : ${pct(summary.citation_correctness)}  (judge)`,
    );
    console.log(
      `Cited a gold page  : ${summary.cited_gold_page}/${summary.answerable}  (deterministic)`,
    );
    console.log(
      `Citations rejected by verification: ${summary.verified_citation_rejections}`,
    );
    console.log(
      `Tokens             : ${summary.tokens_in} in / ${summary.tokens_out} out`,
    );
  }
  const misses = rows.filter((r) => r.answerable && !r.retrieval_hit);
  if (misses.length) {
    console.log(`\nRetrieval misses (${misses.length}):`);
    for (const miss of misses) {
      console.log(
        `  ${miss.id}  gold=${JSON.stringify(miss.gold_pages)} got=${JSON.stringify(miss.retrieved_pages)}  "${miss.question.slice(0, 60)}"`,
      );
    }
  }
  console.log(`\nwrote ${out}`);
}

function pct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(0)}%`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
