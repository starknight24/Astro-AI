# AstroAI — Design Document

**Author:** Santiago (starknight24) · **Last updated:** 2026-10-02 · **Status:** v0.6

---

## 1 · Problem

Engineering students learning orbital mechanics need two things an LLM chatbot
cannot give them:

1. **Numbers that are correct.** A 4%-wrong orbital period is not a rounding
   curiosity to someone sizing a mission. LLM arithmetic is unreliable, and worse,
   it is *confidently* unreliable — the wrong number arrives in the same tone as
   the right one.
2. **Claims that are checkable.** "This paper says X on page 7" is useful only if
   page 7 actually says X. A fabricated citation is more harmful than no citation,
   because it defeats the reader's ability to verify.

The product is a space-physics tutor that answers with cited, step-by-step
working. The engineering thesis is narrower and is what this document is about:

> **A probabilistic system can be made trustworthy by making a deterministic one
> responsible for every fact it asserts, and by measuring the result.**

Concretely: the LLM plans, chooses tools and explains. It never computes a number
and never invents a page reference. Both constraints are enforced in code, and
both are measured by an evaluation harness whose ground truth is the
deterministic engine itself.

### Non-goals

Payments, a 3D orbital simulator, collaborative features, mobile apps. The
scope is deliberately narrow so the thesis can be demonstrated rather than
gestured at.

---

## 2 · Architecture

Three independently deployable packages in one repository
([ADR-001](decisions/ADR-001-service-topology.md)).

```
                     Browser — React 19 + Vite SPA (Vercel)
                              │
                              │  fetch /api/*  +  Supabase access token
                              ▼
            ┌─────────────────────────────────────────────────┐
            │  api/ — Express + TypeScript  (Render)          │
            │  THE ONLY PUBLIC ENTRY POINT                    │
            │                                                 │
            │  requireAuth ─ rate limit ─ idempotency ─ Zod    │
            │          │                                      │
            │          ├── agent/   plan → tools → synthesize  │
            │          ├── rag/     ingest · retrieve · answer │
            │          └── routes/  calculate · papers · admin │
            └───┬───────────┬──────────────┬──────────────┬────┘
                │           │              │              │
                ▼           ▼              ▼              ▼
     Supabase Postgres   science/      Google Gemini   NASA Open APIs
     pgvector · RLS      FastAPI       plan/tools/     APOD · NeoWs
     deny-all            INTERNAL      synthesis       1-hour cache
                         ┌──────────────────────┐
                         │ orbital.py  6 formulas│
                         │ iss.py      SGP4+TLE  │
                         │ pdf.py      PyMuPDF   │
                         │ chunking.py sections  │
                         └──────────────────────┘
```

Auth, validation, rate limiting and every secret live at the `api/` boundary. The
browser never holds a Gemini or NASA key and never talks to Postgres — RLS is
enabled on all **14** tables with **no policies**, so the public anon key can read
nothing.

### The agent loop

Hand-written, three explicit phases, no framework
([ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md)):

```
problem
  │  guardrail: injection patterns redacted, text wrapped as untrusted data
  ▼
[1 PLAN]        one model call, NO tools. Produces a written plan and an
  │             in-domain verdict. Refusals happen here, before any tool
  │             call or NASA quota is spent.
  ▼
[2 TOOL LOOP]   Gemini function calling · ≤6 rounds · ≤10 calls · 90 s budget
  │             each call: coerce args → Zod → timeout raced against the
  │             executor → backoff on transient failure only → scrub the
  │             result → record a trace row
  │             Tools: orbital_calculator · iss_position · apod · neo_lookup
  ▼
[3 SYNTHESIZE]  one model call constrained to the answer contract, given ONLY
                the collected tool results. A numeric-grounding check flags any
                value that no tool produced.
  ▼
{ answer, plan, trace, meta }   ← the full trace ships in the API response
```

**Why three calls and not one.** The separate planning call buys a refusal before
any budget is spent, a written plan in the trace to compare against what the agent
actually did, and an explicit `missing_information` list — which is what turns
"what's the period at 400?" into a clarifying question instead of a guess. The
separate synthesis call means the model composing the answer **cannot** call a
tool, so it cannot quietly recompute a number. The cost is latency, measured and
discussed in §8.

### RAG with verified citations

```
PDF → PyMuPDF (two passes) → clean → section-aware chunks → embed → pgvector
                                                                       │
question → embed → vector top-20 ─┐                                    │
                                  ├─ RRF fuse → top-6 ─────────────────┘
          full-text top-20 ───────┘                       │
                                                          ▼
                                            grounded answer + citations
                                                          │
                                        CODE verifies every cited page
                                        against the retrieved chunk;
                                        zero valid citations → refusal
```

Two extraction passes because neither suffices: plain text has correct spacing
(the span-level dict loses inter-word spaces in 3 of 5 test papers), while the
dict layer has the font size and weight that identify headings. Typography decides
*which* lines are headings; plain text supplies *what* they say
([ADR-006](decisions/ADR-006-chunking-and-retrieval.md)).

---

## 3 · Data model

Fourteen tables across four migrations. The ones that carry the design:

| Table | Purpose | Notable decision |
|---|---|---|
| `users` | identity | `id` **references `auth.users(id)`** — auth and app data share a primary key, so there is no UID to synchronise ([ADR-004](decisions/ADR-004-authentication.md)) |
| `papers` | uploaded PDFs | `content_hash` unique per user, so re-uploading the same file cannot duplicate it |
| `paper_chunks` | retrieval units | `embedding vector(768)`, `page` **and** `page_end` (a chunk crosses pages; a citation must not lie), `section_index` for document order, generated `content_tsv` + GIN |
| `paper_threads` / `paper_messages` | per-paper Q&A | the thread is anchored to a paper, so retrieval scope is a foreign key rather than a convention; `citations` stored so a claim can be re-checked later |
| `agent_traces` | one row per LLM call | rows share a `request_id`; **no foreign keys**, so a request that fails before touching `users` still records |
| `agent_tool_calls` | one row per tool call | arguments *after* Zod validation, `attempts` (>1 means retry fired), `cache_hit` |
| `eval_runs` / `eval_results` | conditions under test, and what happened | `git_sha`, `prompt_version`, `model` — a result with no conditions is uninterpretable |
| `api_cache` | third-party responses | jsonb + `expires_at`; inspectable with SQL |
| `rate_limit_counters` | fixed-window counts | PK `(bucket, key, window_start)`; one atomic upsert per request |
| `idempotency_keys` | safe retries | stores a body hash, so a reused key with a different body is rejected rather than silently answered |

**Deliberately absent: prompt and answer text.** `agent_traces` records tokens and
latency but no words. A student's problem statement is the content of the product,
not telemetry — the same reason Sentry's `beforeSend` strips request bodies.

---

## 4 · Key decisions

Each links to the ADR with the alternatives and the costs.

| # | Decision | Why, in one line |
|---|---|---|
| [001](decisions/ADR-001-service-topology.md) | Monorepo, three services; Python for science | NumPy/SGP4/PyMuPDF have no serious Node equivalent; TypeScript keeps types shared with the SPA |
| [002](decisions/ADR-002-pgvector-vs-pinecone.md) | pgvector, not Pinecone | chunks and their metadata in one database makes per-user scoping a `WHERE` clause |
| [003](decisions/ADR-003-deterministic-physics-engine.md) | A deterministic physics engine | **a system cannot be graded by itself** — the eval harness needs ground truth the model did not produce |
| [004](decisions/ADR-004-authentication.md) | Supabase JWT verified at the API | one identity, no second vendor, no symmetric secret to leak |
| [005](decisions/ADR-005-agent-loop-and-guardrails.md) | Hand-written agent loop | the loop *is* the deliverable; a framework would supply the exact parts worth explaining |
| [006](decisions/ADR-006-chunking-and-retrieval.md) | Section-aware chunking, hybrid retrieval, citations verified in code | a chunk is what a page number points at, so chunking is a correctness concern |
| [007](decisions/ADR-007-eval-design.md) | Engine-generated goldens, versioned judge | expected answers are **computed**, never typed by hand |
| [008](decisions/ADR-008-hardening-and-operations.md) | Postgres rate limits, fail-open, metrics endpoint | the smallest controls that are measurable and explainable |

### The three that matter most

**The model never computes.** `orbital_calculator` is a pass-through to Python.
After synthesis, every number in the answer is matched against the numbers the
tools returned; unmatched values are reported in `caveats` and in the trace. A
tolerance-graded eval compares the agent's answer to the engine's.

**The model cannot invent a citation.** It returns `{chunk_index, page, quote}`;
the code checks that the chunk was retrieved *in this request* and that the page
falls inside that chunk's real range. Invalid citations are dropped, and an answer
with none left is **downgraded to a refusal**. That is why "citations are real" is
a property of the system and not a hope about the prompt.

**Prompt injection is handled by blast radius, not by filtering.** Tools are
reachable only through a Zod-validated registry, so a successful injection
produces a wrong *answer* — never a shell, a DB write, an outbound request to an
attacker's host, or a secret. No secret is ever in the model's context. The
pattern filter is defence in depth, and the limitation is stated rather than
hidden.

---

## 5 · Evaluation results

Measured, with denominators. Full history and run conditions in
[eval-history.md](eval-history.md); design and limitations in
[ADR-007](decisions/ADR-007-eval-design.md).

```
v0.6
Physics accuracy    : 100%   (3/3 graded, 2 of 6 not reached — model quota)
Retrieval hit-rate  :  96%   (22/23, hybrid, top_k=6, full gold set)
Refusal accuracy    : 100%   (4/4 unanswerable correctly refused)
Faithfulness        : 100%   (judge-v1, 5 answers)
Citation correctness: 100%   (judge-v1) · 5/5 cited a gold page (deterministic)
Citations rejected by code verification: 0
```

**Datasets.** 60 physics questions whose expected values are *computed* by
`science/orbital.py` — spot-checked against published references (ISS period
92.56 min, GEO 23.934 h, surface escape velocity 11.19 km/s, LEO→GEO Hohmann
3.85 km/s, all within 0.1%). 28 paper-QA pairs across 3 arXiv papers, 5 of them
deliberately unanswerable with the absence verified by searching the full text.

**Sample sizes are small and that is a constraint, not a choice.** The Gemini free
tier allows 20 `generateContent` requests per day per model (measured) and one
agent run costs three, so a run samples 6 physics cases. 100% means "nothing
failed in this sample". Retrieval is the exception — it needs embeddings only, so
it runs the full 23-case set and can be re-run freely, which is why it carries
weight the answer-quality numbers do not.

### The experiment that changed a decision

[EXP-001](experiments/exp-001.md) — hybrid retrieval vs vector-only, one variable,
everything else held fixed:

| | hybrid | vector-only |
|---|---|---|
| Retrieval hit-rate | **95.7%** (22/23) | 91.3% (21/23) |
| MRR | **0.8007** | 0.7645 |

Hybrid fixed one case and broke none. The case it fixed is the mechanism ADR-006
predicted: *"What service life had been declared?"* is almost verbatim the paper's
phrase *"a declared service life of at least five years"*, so full-text search put
page 1 first while the embedding drifted to pages that *discuss* lifetime at
length without stating the figure. **Decision: keep hybrid on.** Honest caveat:
n=23, so this confirms a prior rather than overturning one — but the simpler path
was already implemented behind a flag, so it could have gone the other way.

### What evaluation caught that review would not

Three prompt-version bumps, each from a specific measured failure:

- `agent-v2` — a −500 km altitude was refused as *out of domain* (the subject was
  fine; the number was not). Also: unit assumptions applied silently, and 15
  significant figures in prose.
- `agent-v3` — asked for "the Hohmann transfer delta-v" with **no orbits given**,
  the agent invented 300 km → 35,786 km, answered, and described those altitudes
  as *"provided"*. The planner had flagged them as missing; the synthesiser
  answered anyway with a caveat.

All three would have passed a review that read the numbers instead of the
question — every one of those answers was arithmetically correct and carried an
honest-sounding caveat. That is the argument for the harness.

---

## 6 · Load-test results

Measured with k6 v2.3.0. Full method, decomposition and caveats in
[load-test.md](load-test.md).

| Scenario | Requests | p50 | p95 | p99 | 5xx |
|---|---|---|---|---|---|
| Calculator through the API | **4,449** | **10.44 ms** | 14.25 ms | 16.02 ms | **0** |
| Science service alone | 4,450 | **1.64 ms** | 2.18 ms | 2.63 ms | 0 |

Every calculator response was verified against the closed-form period in the k6
script: **8,898 / 8,898 checks passed**. Both latency thresholds passed, and the
Week-7 exit criterion — survive the scenario without a 5xx storm — was met with
zero failures.

### The bottleneck, measured rather than assumed

The API layer costs **~8.8 ms** over the engine's 1.64 ms. The obvious suspect was
JWT verification. It was wrong:

| Component | p50 | Verdict |
|---|---|---|
| `jwtVerify` (JWKS cache warm) | **0.05 ms** | negligible |
| science hop (`fetch` + JSON) | 1.84 ms | real and necessary |
| **one `pool.query` round trip** | **0.90 ms** | **×2 per request** |

`upsertUser` ran on **every** authenticated request for a statement that is
`ON CONFLICT DO NOTHING` — a no-op after the first success. It is now memoised per
process. The claim is *one fewer database round trip per request*, proven by test
(50 requests → 1 query) rather than by a latency graph: the expected ~0.9 ms
saving is below the measured run-to-run noise floor of **1.80 ms** on that path.
An earlier attempt appeared to show the change making things worse while the
*untouched* Express baseline also moved — which is how the noise was caught
instead of published.

### The finding that reframes the exercise

| Layer | Cost | Share of an agent request |
|---|---|---|
| Three model calls | **13,000–45,000 ms** | ~99.9% |
| API layer | 8.8 ms | 0.06% |
| Physics engine | 1.64 ms | 0.01% |

**The system's latency is three LLM calls.** Optimising infrastructure here would
be optimising 0.06%. The levers that matter are architectural: collapse plan and
tool phases into one call (ADR-005 records the trigger and the cost — the pre-tool
refusal is lost), stream synthesis so first tokens arrive in ~1 s, and cache whole
answers for the repeated questions a tutoring app sees. None is an infrastructure
change.

---

## 7 · Testing & operations

**561 tests, all passing.**

| Suite | Count | Notes |
|---|---|---|
| `api` (vitest) | 298 | **113** run against **real PostgreSQL 17 + pgvector 0.8** in-process via PGlite — the retrieval SQL, HNSW index, `<=>` operator, `websearch_to_tsquery`, the rate-limit upsert's atomicity and the metrics percentiles are all exercised, not mocked |
| `science` (pytest) | 203 | fully offline: fixture PDFs are *generated* in the tests, and the ISS tests use a committed TLE whose position was cross-checked against an independent SGP4 service to **0.1 km** |
| `evals` (pytest) | 60 | the grading logic, because a bug there silently misreports every number |

**18 live adversarial cases** ([failure-modes.md](failure-modes.md)) covering
ambiguous units, impossible and contradictory parameters, missing parameters,
injection in the problem text *and* in tool output, tool failure, tool timeout,
out-of-domain requests, and a request designed to need 80 tool calls. 15 passed
first time; the 3 failures all had one root cause and are fixed and re-verified.

**CI** runs lint, typecheck, build and tests for all three packages, plus
`npm audit --omit=dev` and a check that the physics dataset is not stale relative
to the engine. Model-calling evals are `workflow_dispatch` — a 15-question smoke
run costs 45 model calls against a 20/day cap, so putting it on every PR would
report quota failures as regressions.

**Security.** [security-review.md](security-review.md) is a per-item OWASP 2021
audit: 7 findings, 5 fixed (including two high-severity dependency CVEs and a
`trust proxy` misconfiguration that would have collapsed per-IP rate limiting),
2 accepted with reasoning. Production dependencies report **0 vulnerabilities**.

---

## 8 · Future work

In the order I would actually do it.

1. **A paid Gemini key.** The binding constraint on everything above. 20
   requests/day/model caps the eval at 6 physics cases, prevents CI from running
   evals, and makes k6 concurrency tests on the LLM paths impossible. This is
   the single change that most improves the *evidence*, not the product.
2. **Reduce the agent to two model calls** (ADR-005's revisit trigger) and measure
   whether refusal quality regresses. ~⅓ of the latency, and the harness exists
   to tell us the cost.
3. **Stream the synthesis phase.** Does not reduce total time but moves perceived
   latency from ~13 s to ~1 s, which is the number a user feels.
4. **Require `WEB_ORIGIN` in production** — the one open medium-severity security
   item, deliberately left for a deliberate deploy.
5. **Semantic chunking**, measured against the EXP-001 baseline. The one
   remaining retrieval miss (`rag-015`: a fact in a subordinate clause, "a period
   of 27.32 days") is a chunk-granularity problem; a bigger `top_k` would trade
   precision for it instead of fixing it.
6. **Persist client state.** Notes, telemetry and quiz history are React state and
   vanish on refresh. The schema exists; the wiring does not.
7. **Alerting.** Sentry reports errors; nothing reports "p95 doubled".
8. **OCR for scanned PDFs**, currently rejected outright with an honest message.
9. **Equation and table extraction.** The measured weakness of the RAG pipeline:
   prose and numbers survive, equations arrive as fragments, table structure is
   lost.

## References

- ADRs [001](decisions/ADR-001-service-topology.md)–[008](decisions/ADR-008-hardening-and-operations.md)
- [eval-history.md](eval-history.md) · [experiments/exp-001.md](experiments/exp-001.md) · [failure-modes.md](failure-modes.md)
- [load-test.md](load-test.md) · [security-review.md](security-review.md) · [rag-ingestion-findings.md](rag-ingestion-findings.md)
- [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
