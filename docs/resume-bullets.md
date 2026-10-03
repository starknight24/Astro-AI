# Resume Bullets

Drafted from verified numbers only. Every figure traces to a file in this
repository, named in the "evidence" line underneath.

**Deliberately absent:** users, adoption, accuracy *improvements*, latency
*improvements*, cost savings, team size, business impact. None of those exist, so
none of them appear. Nothing here says "improved X by Y%" because there is no
before-and-after that survives its own noise floor — the one optimisation that was
applied is described as what it provably does, not as a percentage.

---

## Primary — pick 3–4

**Built an LLM agent for orbital mechanics where the model orchestrates but never
computes: a hand-written plan → tool-call → synthesize loop over 4 tools, with
Zod-validated arguments, per-tool timeouts raced against the executor,
exponential backoff, a 6-iteration cap, and a post-synthesis check that every
reported number traces to a tool result.**
*Evidence: `api/src/agent/` · ADR-005 · 298 API tests*

**Made paper citations verifiable in code rather than trusted: the answerer's cited
page is checked against the retrieved chunk's real page range, invalid citations
are dropped, and an answer left with none is downgraded to a refusal — measured at
100% citation correctness and 4/4 correct refusals on deliberately unanswerable
questions.**
*Evidence: `api/src/rag/answer.ts` · ADR-006 §7 · `docs/eval-history.md`*

**Designed an evaluation harness whose ground truth is deterministic: 60 physics
questions with expected values computed by the project's own Python engine rather
than written by hand, plus 28 paper-QA pairs with page-level gold labels — the
harness caught three agent failures that were arithmetically correct and would
have passed manual review, including one where the agent invented the missing
inputs and described them as "provided".**
*Evidence: `evals/` · ADR-007 · `docs/failure-modes.md` · prompt versions agent-v1→v3*

**Ran a controlled retrieval experiment (hybrid vector + full-text vs. vector-only,
one variable changed): 95.7% vs. 91.3% gold-page hit-rate and MRR 0.80 vs. 0.76
across 23 labelled questions, and kept hybrid retrieval on the strength of it.**
*Evidence: `docs/experiments/exp-001.md`*

**Load-tested with k6 and located the bottleneck by measurement rather than
assumption: 4,449 requests at p50 10.4 ms / p99 16.0 ms with zero 5xx and 100% of
responses verified against the closed-form solution; JWT verification turned out to
be 0.05 ms while two per-request database round trips cost 0.90 ms each, and the
whole API layer was 0.06% of a 13-second agent request.**
*Evidence: `docs/load-test.md` · `load/`*

---

## Secondary — use as needed

**Implemented ISS pass prediction from Celestrak TLEs with SGP4 and a hand-written
TEME→ECEF→topocentric frame chain, agreeing with an independent SGP4 service to
0.1 km; rejected Open Notify after measuring it 29 minutes (~13,000 km) stale.**
*Evidence: `science/iss.py` · 40 tests · ADR-005*

**Built a section-aware PDF chunking pipeline for academic papers, sized from
measurement (median paragraph 509 chars across 5 real arXiv papers → 1400-char
target); handled the AASTeX case where section headings carry no typographic
signal at all, taking one paper from 1 detected heading to 13.**
*Evidence: `science/{pdf,chunking}.py` · ADR-006 · `docs/rag-ingestion-findings.md`*

**Chose 768-dimension embeddings over the model's native 3072 after verifying that
pgvector refuses to build either ANN index above 2000 dimensions — making the
larger vector sequentially-scannable only.**
*Evidence: ADR-006 §5*

**Tested retrieval against real PostgreSQL 17 + pgvector 0.8 in-process (PGlite)
rather than mocking the pool, so the SQL, HNSW index, cosine operator and
full-text query are exercised: 113 of 298 API tests run against a real database
with no Docker.**
*Evidence: `api/src/rag/testdb.ts`*

**Hardened the API: per-user and per-IP fixed-window rate limiting with buckets
sized from what each route costs, idempotency keys that reject a reused key with a
different body rather than replaying the wrong answer, and a metrics endpoint
computing p50/p95/p99 from the tracing tables in SQL.**
*Evidence: `api/src/middleware/` · ADR-008 · 64 tests*

**Completed an OWASP Top-10 review of the codebase: 7 findings, 5 fixed including
two high-severity dependency CVEs and a `trust proxy` misconfiguration that would
have collapsed all per-IP rate limiting into a single counter; production
dependencies now report zero vulnerabilities, with `npm audit` added to CI.**
*Evidence: `docs/security-review.md`*

**Documented 8 architecture decision records, each with alternatives considered and
the cost accepted — including a measured latency cost (1.84 ms per physics call)
that an earlier ADR had accepted without measuring.**
*Evidence: `docs/decisions/`*

---

## One-line project summary

> **AstroAI** — a space-physics tutor where a Python engine owns every number and
> page citations are verified in code, with an evaluation harness graded against
> that engine (100% physics on 3 graded cases, 96% retrieval hit-rate on 23),
> k6 load testing (4,449 requests, 0 × 5xx, p50 10.4 ms), and 8 ADRs.
> TypeScript · Python · Postgres/pgvector · Gemini.

---

## Honest framing notes

Say these if asked. They make the rest more credible, not less.

- **"100%" is on 3 graded physics cases and 5 judged answers.** The Gemini free
  tier allows 20 requests/day/model and one agent run costs three. Quote the
  denominator every time; it is in the bullet.
- **96% retrieval is the number to lean on** — full 23-case set, re-runnable
  because it needs no model calls.
- **87% → 96% retrieval is a label fix, not an improvement.** An over-narrow gold
  label manufactured a false miss. Both rows are kept in `eval-history.md`.
- **The one performance optimisation has no before/after number** because the
  effect (~0.9 ms) is below the measured noise floor (1.80 ms). The claim is one
  fewer database round trip, proven by a test.
- **Nothing is deployed from Weeks 4–8.** The code is committed and tested
  locally; the live API predates this work and its database is unreachable.
