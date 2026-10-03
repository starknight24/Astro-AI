# Load Testing & Bottleneck Analysis

Every number here was measured on this machine with k6 v2.3.0 and the scripts in
[`load/`](../load/). Nothing is projected or estimated. Where a measurement could
not be made, that is stated rather than filled in.

**Headline finding:** the API layer costs ~8 ms and the physics costs 1.6 ms,
while one agent request costs **13,000–45,000 ms**. The system's latency is not
an infrastructure problem — it is three LLM calls. Optimising the 8 ms would be
optimising 0.06% of an agent request.

---

## Environment

| | |
|---|---|
| Host | Apple Silicon laptop, services on localhost |
| k6 | v2.3.0 |
| API | Node 22.23.1, Express, `tsx src/server.ts` |
| Science | FastAPI + uvicorn, Python 3.14 |
| Database | **unreachable** (the Supabase project's host is NXDOMAIN) |
| Auth | real `requireAuth`, verifying against a local JWKS (`load/local-auth.mjs`) |

Two consequences, stated up front because they bound what these numbers mean:

1. **The database is unreachable.** Both per-request DB calls (`upsertUser` and
   the rate-limit upsert) fail at DNS. They still cost time — measured at 0.90 ms
   p50 each — but in production they would be real network round trips to
   Supabase, i.e. **larger**, not smaller. The rate limiter therefore also fails
   open during these runs, so these numbers do not exercise throttling; that is
   covered by 19 unit tests against real Postgres instead.
2. **Auth is real, not bypassed.** `load/local-auth.mjs` serves a JWKS and mints
   an RS256 token, so `requireAuth` runs unmodified — jose, the JWKS fetch, its
   cache and the signature check. A test-only bypass would have measured a code
   path that does not exist in production.

---

## Scenario 1 · Calculator (the deterministic path)

The only endpoint that can be pushed hard: no LLM, microseconds of CPU, one
dependency.

```bash
k6 run load/calculator.js        # ramp 5 -> 50 req/s, hold 60s
```

| Metric | Result |
|---|---|
| Requests | **4,449** |
| Throughput | 34.2 req/s average (ramp 5→50, 60 s hold) |
| **p50** | **10.44 ms** |
| **p95** | **14.25 ms** |
| **p99** | **16.02 ms** |
| max | 161.51 ms |
| **Failures (5xx)** | **0 / 4,449 (0.00%)** |
| Correctness checks | **8,898 / 8,898 passed (100%)** |

Every response was checked against the closed-form period
`T = 2π√(a³/μ)` computed in the k6 script, so this is a correctness test under
load as well as a latency test. **Both thresholds passed** (`p95<800 ms`,
`p99<1500 ms`, `5xx rate<1%`).

**Week 7 exit criterion met:** the scenario completed with zero 5xx.

---

## Scenario 2 · Science service alone (isolating the API layer)

The same arrival profile against the science service directly, with no API in
front of it. The difference between this and Scenario 1 is the cost of the API
layer — and it is the number [ADR-001](decisions/ADR-001-service-topology.md)
accepted without measuring ("every physics call pays an HTTP hop") and
[ADR-003](decisions/ADR-003-deterministic-physics-engine.md) put "on the
measurement docket".

```bash
k6 run load/science-direct.js
```

| Metric | Science alone | Through the API | Difference |
|---|---|---|---|
| p50 | **1.64 ms** | 10.44 ms | **+8.80 ms** |
| p95 | **2.18 ms** | 14.25 ms | +12.07 ms |
| p99 | **2.63 ms** | 16.02 ms | +13.39 ms |
| max | 5.01 ms | 161.51 ms | — |
| Failures | 0 / 4,450 | 0 / 4,449 | — |

So the engine answers in **1.64 ms** and the API layer adds **~8.8 ms**.

---

## Scenario 3 · Decomposing the API layer

The obvious guess would be "JWT verification is expensive". It is not. Measured
per-layer, 800 samples each at 20 req/s:

```bash
k6 run load/api-layers.js
```

| Layer | What it includes | p50 | p95 |
|---|---|---|---|
| `express` (`GET /health`) | Express routing only | **0.94 ms** | 1.41 ms |
| `auth_reject` (401, no token) | + the auth decision on the reject branch | **0.75 ms** | 1.40 ms |
| `full` (`POST /api/calculate/period`) | + JWT verify, user upsert, rate-limit upsert, Zod, science hop | **8.94 ms** | 11.00 ms |

Rejecting an unauthenticated request is **free** (0.75 ms, no JWKS work needed) —
which is the right shape for a public endpoint.

Then the individual components, benchmarked in-process (200 iterations for the
cheap ones):

| Component | p50 | p95 | Verdict |
|---|---|---|---|
| `jwtVerify` (JWKS cache warm) | **0.05 ms** | 0.22 ms | negligible — the guess was wrong |
| science hop (`fetch` + JSON) | **1.84 ms** | 2.80 ms | real, and matches the 1.64 ms service time |
| **one `pool.query` round trip** | **0.90 ms** | 2.51 ms | **×2 per request** |

**The bottleneck is per-request database calls, not auth crypto and not the HTTP
hop.** Two of them run on every authenticated request:

1. `upsertUser` in `requireAuth` — `INSERT … ON CONFLICT DO NOTHING`, i.e. a
   **no-op after the first success**, running on every request forever.
2. the rate-limit counter upsert — genuinely needed per request, because that is
   how counting works.

---

## The fix

**`upsertUser` is now memoised per process** (`api/src/lib/db.ts`): a bounded,
TTL'd map of users already known to exist, so the statement runs once per user
per hour instead of once per request. Recorded only on success, so a transient
failure is retried rather than cached as done.

**Proven by test, not by timing** — `db.test.ts` → *"skips the database on later
requests for the same user"*: 50 requests produce **1** query. That is the
claim: one fewer database round trip per authenticated request.

### Why there is no before/after latency number

Because the effect is smaller than the noise. Three **identical** runs of the
same binary:

| Run | `express` p50 | `auth_reject` p50 | `full` p50 |
|---|---|---|---|
| 1 | 1.04 ms | 0.90 ms | 10.68 ms |
| 2 | 0.94 ms | 0.78 ms | 10.72 ms |
| 3 | 1.03 ms | 1.00 ms | 8.92 ms |
| **spread** | **0.10 ms** | **0.21 ms** | **1.80 ms** |

The cheap layers are stable to 0.1–0.2 ms, but the `full` path — the one that
makes network calls — varies by **1.80 ms** run to run. The expected saving is
~0.90 ms, i.e. **half the noise floor**, so a local p50 comparison cannot
demonstrate it. An earlier attempt appeared to show the change making things
*worse* by 1.00 ms, while the untouched `express` baseline also moved +0.20 ms in
the same pair of runs — which is how the noise was caught rather than published.

In production the saving is larger, not smaller: the round trip is to Supabase
over the network, where a query is tens of milliseconds rather than a 0.90 ms
DNS failure. The optimisation is justified by the removed round trip, and the
honest statement is that its local latency effect is unmeasurable here.

---

## Scenario 4 · The LLM paths, and why they are not k6 scenarios

`load/agent.js` and `load/rag.js` exist and run, but they are deliberately
2-VU scripts rather than throughput tests, and **no concurrency numbers are
reported from them**. The reason is a hard constraint, not caution:

- One agent request costs **3+ `generateContent` calls**.
- The Gemini free tier allows **20 per day per model** (measured).
- The Week-7 rate limit allows **10 agent requests per hour per user**.

A 50-VU agent run would exhaust the day's entire budget in under a second and
then measure nothing but 429s. So agent and RAG latency comes from the **eval
harness and the end-to-end script**, which instrument the same code path and
record `duration_ms` per request:

| Path | Source | p50 | p95 | max |
|---|---|---|---|---|
| Agent, `gemini-3.7-flash` | physics eval run | **13.0 s** | 23.6 s | 23.6 s |
| Agent, `gemini-3.1-flash-lite` | physics eval run | **14.2 s** | 15.6 s | 15.6 s |
| Agent, `gemini-3.6-flash` | physics eval run | **44.9 s** | 228.1 s | 228.1 s |
| Agent, `gemini-3.5-flash` (production default) | Week-4 exit run | 124 s (single request, during a demand spike) | — | — |
| RAG question (retrieve + 1 model call) | `rag-e2e.ts`, 4 questions | **2.1–5.7 s** | — | 5.7 s |
| Paper ingestion (20 pages → 65 chunks, incl. embeddings) | `rag-e2e.ts` | **2.7–5.8 s** | — | 5.8 s |
| PDF extraction + chunking only (no embeddings) | science service | **0.38 s** | — | — |

The spread across models is the point: **the model choice changes end-to-end
latency by 3×**, and a single demand spike produced a 228 s outlier. Nothing in
our code moves the needle by comparable amounts.

---

## Where the time actually goes

One agent request, using the measured components:

```
  plan model call        ~13,000 ms   (one of three; p50 for the whole request)
  tool round model call      ↕        model-dominated
  synthesis model call       ↕        model-dominated
  ───────────────────────────────────────────────────────────
  orbital_calculator tool        36 ms   (measured in the Week-4 trace)
  science engine itself        1.64 ms   (measured, Scenario 2)
  API layer overhead          ~8.8 ms   (measured, Scenario 3)
  JWT verification            0.05 ms   (measured)
```

**The API layer is ~0.06% of an agent request.** The physics — the thing the
product is about — is ~0.01%.

### The real bottleneck, and what would fix it

Three model calls per request is the floor of the current design
([ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md) §1: plan →
tool loop → synthesize). The levers, in order of expected effect:

1. **Collapse plan and tool phases into one call.** Saves ~⅓ of the latency.
   ADR-005 already records this as the revisit trigger and the cost: the
   pre-tool refusal would be lost, so out-of-domain requests would spend a tool
   call before being refused. Needs the eval harness to confirm refusal quality
   does not regress — which is exactly what it is for.
2. **Stream the synthesis phase.** Does not reduce total time but puts first
   tokens on screen in ~1 s instead of ~13 s, which is the number a user
   actually feels.
3. **Cache whole answers for repeated questions.** The 1-hour cache already
   exists for NASA data (`api_cache`); the physics questions in a tutoring app
   repeat heavily, and a cache hit would skip all three model calls.

Notably **none** of these is an infrastructure change, and the one optimisation
this exercise did apply (removing a DB round trip) is not among them — because
measurement showed the infrastructure was never the problem.

---

## Reproducing

```bash
# 1. science service
cd science && ./.venv/bin/uvicorn main:app --port 8000 &

# 2. local JWKS + a token (prints the token on stdout)
cd api && node ../load/local-auth.mjs --ttl 7200 > /tmp/token.txt &

# 3. API against that JWKS
SUPABASE_URL=http://127.0.0.1:8899 SCIENCE_URL=http://127.0.0.1:8000 \
  PORT=3101 npx tsx src/server.ts &

# 4. the scenarios
export TOKEN=$(cat /tmp/token.txt) API_URL=http://127.0.0.1:3101
k6 run load/calculator.js
k6 run load/science-direct.js
k6 run load/api-layers.js
```

## What these numbers do not cover

- **Rate limiting under load.** Its store was unreachable, so it failed open
  throughout. Verified separately by 19 unit tests against real Postgres,
  including atomic increments under 10-way concurrency.
- **Real database latency.** Every DB call failed at DNS. Production numbers
  will be higher wherever a query is on the path.
- **Concurrency on the LLM paths.** Quota-bound, as explained above.
- **The deployed environment.** These are localhost numbers; Render adds network
  latency and runs on smaller hardware.
- **Sustained load.** The longest run was 2 minutes 10 seconds. Nothing here
  speaks to memory growth, connection-pool exhaustion or leaks over hours.
