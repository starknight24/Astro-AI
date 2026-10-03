/**
 * RAG load test: embeddings + pgvector retrieval + one model call.
 *
 * Needs a paper already ingested, because ingestion is a different (much more
 * expensive) operation and mixing them would make the numbers unattributable:
 *
 *   k6 run -e PAPER_ID=<uuid> load/rag.js
 *
 * Like the agent scenario this runs few VUs — one model call per question
 * against a 20/day/model free tier, and a 10/hour upload bucket.
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const API_URL = __ENV.API_URL || "http://localhost:3001";
const TOKEN = __ENV.TOKEN || "";
const PAPER_ID = __ENV.PAPER_ID || "";

const rateLimited = new Counter("rate_limited_429");
const refusals = new Counter("rag_refusals");
const citations = new Trend("rag_citations");
const answerDuration = new Trend("rag_answer_ms", true);

export const options = {
  scenarios: {
    light: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 2),
      duration: __ENV.DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: false }],
    // One model call plus two indexed queries.
    "http_req_duration{expected_response:true}": ["p(95)<60000"],
  },
};

const QUESTIONS = [
  "Which atmospheric density model did the authors use?",
  "What was the NORAD ID of the satellite?",
  "How long did the mission last compared with its design lifetime?",
  "What ballistic coefficient did the authors infer?",
  "What was the total contract cost in US dollars?", // expected to be refused
];

export function setup() {
  if (!PAPER_ID) {
    throw new Error("PAPER_ID is required: ingest a paper first, then pass -e PAPER_ID=<uuid>");
  }
  return { paperId: PAPER_ID };
}

export default function (data) {
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const res = http.post(
    `${API_URL}/api/papers/${data.paperId}/ask`,
    JSON.stringify({ question }),
    {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      timeout: "120s",
      tags: { name: "papers/ask" },
    },
  );

  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }

  check(res, {
    "status is 200": (r) => r.status === 200,
    "answered or refused, never ungrounded": (r) => {
      if (r.status !== 200) return false;
      try {
        const body = r.json();
        answerDuration.add(body.duration_ms);
        if (body.outcome === "refused_unsupported") {
          refusals.add(1);
          return body.citations.length === 0;
        }
        citations.add(body.citations.length);
        // The invariant: an answered response must carry at least one verified
        // citation. Anything else means the grounding check regressed.
        return body.outcome === "answered" && body.citations.length > 0;
      } catch {
        return false;
      }
    },
  });
}
