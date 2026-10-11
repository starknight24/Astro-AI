# 🚀 AstroAI

A space-physics tutor whose numbers come from a deterministic engine and whose
citations are verified in code — not from a model's confidence.

**The engineering thesis:** a probabilistic system can be made trustworthy by
making a deterministic one responsible for every fact it asserts, and by
measuring the result.

---

## Measured results

Every number below came from a run of the harness in [`evals/`](evals) or from k6.
Nothing is estimated. Denominators included, because the samples are small.

```
v0.6 · evaluation
Physics accuracy    : 100%   (3/3 graded, 2 of 6 not reached — model quota)
Retrieval hit-rate  :  96%   (22/23, hybrid, top_k=6, full gold set)
Refusal accuracy    : 100%   (4/4 unanswerable questions correctly refused)
Faithfulness        : 100%   (LLM judge, judge-v1, 5 answers)
Citation correctness: 100%   (judge) · 5/5 cited a gold page (deterministic)
Citations rejected by code verification: 0
```

```
v0.6 · performance (k6 v2.3.0)
Calculator through the API : 4,449 requests · p50 10.44 ms · p95 14.25 ms · p99 16.02 ms · 0 × 5xx
Science engine alone       : 4,450 requests · p50  1.64 ms · p95  2.18 ms
  → the API layer costs ~8.8 ms; jwtVerify is 0.05 ms of it
Agent, end to end          : p50 13.0 s · p95 23.6 s   (three model calls)
Paper ingestion            : 20 pages → 65 chunks in 2.7 s
Paper question             : 2.1–5.7 s
```

**The headline finding:** the API layer is 0.06% of an agent request and the
physics is 0.01%. This system's latency is three LLM calls, not infrastructure —
so the optimisations that matter are architectural, and
[docs/load-test.md](docs/load-test.md) says which.

**Tests:** 561 passing — 298 API (113 of them against real PostgreSQL 17 +
pgvector 0.8, in-process), 203 science, 60 eval harness. Plus 18 live adversarial
cases.

> Sample sizes are set by the Gemini free tier's **20 `generateContent` requests
> per day per model** (measured). 100% means "nothing failed in this sample", not
> "nothing fails". Retrieval is the exception — it needs no model calls, so it runs
> the full gold set and carries more weight. See
> [ADR-007 §9](docs/decisions/ADR-007-eval-design.md).

## Live

| | |
|---|---|
| **API** | <https://astro-ai-ri7l.onrender.com> — verified responding (`/health` → `200`) |
| **Web** | deployed to Vercel from `web/`; URL in the project's Vercel dashboard |

⚠️ **The deployed build predates this work.** Weeks 4–7 (the agent, the RAG
pipeline, rate limiting, metrics, Sentry) are committed but **not deployed**, and
the Supabase project the deployment points at is currently unreachable, so the
live API cannot authenticate a request. Deploying needs the database restored and
the new environment variables set — see [Quickstart](#quickstart) and
[.env.example](.env.example). Everything in **Measured results** above was measured
locally against the real services, not against this deployment.

---

## Architecture

```
                     Browser — React 19 + Vite SPA (Vercel)
                              │  fetch /api/*  +  Supabase access token
                              ▼
            ┌─────────────────────────────────────────────────┐
            │  api/ — Express + TypeScript  (Render)          │
            │  THE ONLY PUBLIC ENTRY POINT                    │
            │  requireAuth ─ rate limit ─ idempotency ─ Zod    │
            │          ├── agent/   plan → tools → synthesize  │
            │          ├── rag/     ingest · retrieve · answer │
            │          └── routes/  calculate · papers · admin │
            └───┬───────────┬──────────────┬──────────────┬────┘
                ▼           ▼              ▼              ▼
     Supabase Postgres   science/      Google Gemini   NASA Open APIs
     pgvector · RLS      FastAPI       plan/tools/     APOD · NeoWs
     deny-all            INTERNAL      synthesis       1-hour cache
                         ├ orbital.py   6 formulas, 62 tests
                         ├ iss.py       SGP4 + Celestrak TLE
                         ├ pdf.py       PyMuPDF extraction
                         └ chunking.py  section-aware
```

The agent: **plan → tool call(s) → synthesize**, hand-written, ≤6 tool rounds,
per-tool timeouts raced against the executor, Zod-validated arguments, backoff on
transient failures only, and the full trace returned in the API response.

Full picture: [docs/design.md](docs/design.md) ·
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## What makes it trustworthy

**The model never computes a number.** `orbital_calculator` is a pass-through to
Python. After synthesis, every value in the answer is matched against the values
the tools returned; unmatched ones are flagged in the response. The eval harness
grades the agent against the engine — a tolerance comparison with no model in the
loop ([ADR-003](docs/decisions/ADR-003-deterministic-physics-engine.md)).

**The model cannot invent a citation.** It returns `{chunk_index, page, quote}`
and the code checks the chunk was retrieved in *this* request and the page falls
inside that chunk's real range. Invalid citations are dropped; an answer with none
left is downgraded to a refusal
([ADR-006 §7](docs/decisions/ADR-006-chunking-and-retrieval.md)).

**Prompt injection is bounded by blast radius, not by filtering.** Tools are
reachable only through a Zod-validated registry, so a successful injection yields
a wrong *answer* — never a shell, a DB write, or a secret. No secret is ever in
the model's context. Measured against 18 adversarial cases
([docs/failure-modes.md](docs/failure-modes.md)).

**ISS passes use real orbital mechanics.** Celestrak TLEs propagated with SGP4 in
the science service, with the frame chain hand-written. Verified against an
independent SGP4 service to **0.1 km**. Open Notify was measured 29 minutes
(~13,000 km) stale, so it is not used.

---

## Quickstart

Requires Node ≥ 20 (see `.nvmrc`), Python 3.12+, and a Supabase project.

```bash
git clone https://github.com/starknight24/Astro-AI && cd Astro-AI

# Environment. Values live in per-package env files, never at the repo root.
cp .env.example api/.env    # SUPABASE_URL, DATABASE_URL, GEMINI_API_KEY, SCIENCE_URL
cp .env.example web/.env    # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

# Database: run db/migrations/*.sql in order, in the Supabase SQL editor.

# 1 · science service (physics, SGP4, PDF extraction)
cd science
python3 -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/uvicorn main:app --port 8000

# 2 · API
cd api && npm ci && npm run dev          # http://localhost:3001

# 3 · web
cd web && npm ci && npm run dev          # http://localhost:5173
```

`docker-compose up` runs `api` + `science` together when you only need the backend
pair. Running it locally end to end — PostgreSQL, pgvector and real JWT
verification, with no cloud account: [docs/local-setup.md](docs/local-setup.md).
Full setup notes and gotchas: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

### Try the agent without a browser

```bash
cd api
npx tsx scripts/agent-cli.ts "Calculate the orbital period of a satellite at 400 km \
  and tell me when the ISS next passes over Toronto"
```

Prints the plan, every tool call with its arguments and result, each guardrail
that fired, and the final cited answer.

---

## Testing

```bash
cd api     && npx eslint src/ scripts/ && npx tsc --noEmit && npm test && npm run build
cd web     && npx eslint src/          && npx tsc --noEmit && npm run build
cd science && ./.venv/bin/pytest -q
cd evals   && ../science/.venv/bin/pytest -q
```

That is exactly what CI runs. **No test needs the network, a database, or an API
key** — the model client, `fetch` and the pg pool are injected or mocked, retrieval
runs against in-process PostgreSQL via PGlite, and the ISS tests use a committed
TLE fixture. A test that reaches the network is a bug in the test.

### Evaluation and load testing

```bash
# physics: question → full agent → numeric answer → graded against orbital.py
python3 evals/run_physics.py                 # 6-case stratified smoke subset
python3 evals/run_physics.py --full          # all 60

# RAG retrieval — needs embeddings but NO generateContent calls, so it is free
cd api && npx tsx scripts/run-rag-eval.ts --retrieval-only
cd api && npx tsx scripts/run-rag-eval.ts    # + answers + LLM judge

# adversarial suite (18 cases, resumable)
cd api && npx tsx scripts/adversarial.ts

# load tests
k6 run load/calculator.js
k6 run load/science-direct.js
k6 run load/api-layers.js
```

---

## Decisions & tradeoffs

Eight ADRs, each with the alternatives considered and the cost accepted.

| ADR | Decision | The tradeoff |
|---|---|---|
| [001](docs/decisions/ADR-001-service-topology.md) | Monorepo, three services; Python for science | two deploy targets and a CORS seam; every physics call pays an HTTP hop (**measured at 1.84 ms**) |
| [002](docs/decisions/ADR-002-pgvector-vs-pinecone.md) | pgvector over Pinecone | a recall/scale ceiling, and index tuning becomes mine |
| [003](docs/decisions/ADR-003-deterministic-physics-engine.md) | Deterministic physics engine | the engine is load-bearing for evaluation, so a physics bug corrupts grades too |
| [004](docs/decisions/ADR-004-authentication.md) | Supabase JWT verified at the API | a route that forgets `user_id = $1` has no database backstop (asserted by test) |
| [005](docs/decisions/ADR-005-agent-loop-and-guardrails.md) | Hand-written agent loop | three model calls per request is the floor — **the entire latency budget** |
| [006](docs/decisions/ADR-006-chunking-and-retrieval.md) | Section-aware chunking, hybrid retrieval | heading detection is heuristic and will meet a template that defeats it (it warns when it does) |
| [007](docs/decisions/ADR-007-eval-design.md) | Engine-generated goldens, versioned judge | small samples; the judge shares the blind spots of the model it judges |
| [008](docs/decisions/ADR-008-hardening-and-operations.md) | Postgres rate limits, fail-open, metrics endpoint | a Postgres outage is also a rate-limit outage |

Two choices worth calling out because they were measured, not assumed:

- **Hybrid retrieval beats vector-only** by 95.7% → 91.3% hit-rate
  ([EXP-001](docs/experiments/exp-001.md)). One variable changed, decision applied.
- **768-dimension embeddings, not the model's native 3072** — because pgvector
  **cannot build either ANN index above 2000 dimensions**, so 3072 could only ever
  be sequentially scanned. Verified empirically, not recalled.

---

## Status

Weeks 1–7 of an 8-week build are complete and documented. Known gaps are tracked
rather than hidden:

- **Latency.** Three model calls per agent request; p50 13 s. The fix is
  architectural and the trigger is recorded in ADR-005.
- **`WEB_ORIGIN` is not required in production** — the one open medium-severity
  security item ([docs/security-review.md](docs/security-review.md) A05).
- **Client state is in memory.** Notes and telemetry reset on refresh; the schema
  exists, the wiring does not.
- **No OCR**, so scanned PDFs are rejected outright with an honest message.
  Equations extract as fragments and table structure is lost
  ([docs/rag-ingestion-findings.md](docs/rag-ingestion-findings.md)).
- **`POST /api/solve`** still asks the model to do physics — superseded by the
  agent, scheduled for removal.

## Documentation

| | |
|---|---|
| [design.md](docs/design.md) | the 3-page design document: problem, architecture, data model, results |
| [API.md](docs/API.md) | every endpoint, with the agent's answer contract |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | package-by-package detail |
| [eval-history.md](docs/eval-history.md) | every eval run, with its conditions |
| [experiments/exp-001.md](docs/experiments/exp-001.md) | hybrid vs vector-only retrieval |
| [failure-modes.md](docs/failure-modes.md) | 18 adversarial cases, what broke, what was fixed |
| [load-test.md](docs/load-test.md) | k6 results and the bottleneck analysis |
| [security-review.md](docs/security-review.md) | OWASP 2021, item by item |
| [rag-ingestion-findings.md](docs/rag-ingestion-findings.md) | what broke on five real papers |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md) | setup, conventions, verification |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | what it takes to deploy, and what currently blocks it |
| [demo.md](docs/demo.md) | a 3-minute demo script with real outputs |
| [walkthrough.md](docs/walkthrough.md) | 3- and 10-minute talking points |

## License

MIT — see [LICENSE](LICENSE).
