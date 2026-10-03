# Architecture

## Overview

AstroAI is a Git monorepo of three independently deployable packages
([ADR-001](decisions/ADR-001-service-topology.md)):

```
                    Browser (React 19 + Vite SPA, Vercel)
                              │
                              │  fetch /api/*  +  Supabase access token
                              ▼
                    api/  — Express + TypeScript  (Render)
                    the ONLY public entry point
                              │
      ┌───────────────────────┼────────────────────────┬──────────────────┐
      │                       │                        │                  │
      ▼                       ▼                        ▼                  ▼
 Supabase Postgres      science/ — FastAPI      Google Gemini      NASA Open APIs
 (pgvector, RLS)        physics + SGP4          (agent phases)     (APOD, NeoWs)
                        internal only                              1-hour cache
```

Auth, validation, rate limiting and secrets all live at the `api/` boundary.
The browser never holds a Gemini or NASA key, and never talks to Postgres
directly — RLS is enabled with no policies, so the public anon key can read
nothing (migration 001).

## Packages

### `web/` — React 19 + TypeScript + Vite 6 + Tailwind 4

- **Routing** (`main.tsx`): `/` landing, `/login`, `/app/*` behind `RequireAuth`.
  Session state comes from `AuthContext` (Supabase JS).
- **`LandingPage.tsx`** — scroll-driven WebGL cinematic. One `useEffect` owns the
  whole Three.js scene; scroll progress `p ∈ [0,1]` over a 660vh track drives a
  `CatmullRomCurve3` camera path, and DOM overlay stages are mutated directly
  inside a single `requestAnimationFrame` loop. If WebGL init throws, `fail()`
  hides the canvas and runs a DOM-only loop.
  - ⚠️ StrictMode: cleanup disposes the renderer but must **not** call
    `forceContextLoss()` — the effect remounts on the same `<canvas>` and a
    force-lost context cannot be re-acquired.
- **`App.tsx`** — workspace shell: header, telemetry sidebar, six feature tabs
  (Agent Solver, Space Tutor, Orbit Calculator, Problem Sets, NASA Explorer,
  RAG Workspace). Inline style objects here and on the landing page; the feature
  components use Tailwind utilities.
- **`AgentSolver.tsx`** — the agent surface. Renders the answer contract (steps,
  formulas, citations, united quantities, caveats) plus a collapsible trace
  showing every model call, tool call, argument, result and guardrail.
- **`OrbitalCalculator.tsx`** — debounced calls to `/api/calculate/*`; every
  displayed number comes from the engine, never from client-side math.
- **Client state is in-memory.** Notes and telemetry reset on refresh; the
  schema for durable storage exists but is not wired up yet.

### `api/` — Node + Express + TypeScript

| Concern | Implementation |
|---|---|
| Auth | `requireAuth` on all `/api/*`: `jose` verifies a Supabase JWT against the project JWKS, then upserts the user row (best-effort) |
| Validation | Zod per route; the science service re-validates with Pydantic at its own boundary (duplication by design, ADR-003) |
| Agent | `src/agent/` — plan → tool loop → synthesize ([ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md)) |
| Tools | `src/agent/tools.ts` — one registry entry per tool carrying schema, timeout, retries and executor |
| Third-party clients | `src/lib/nasa.ts` (timeout + retry + 1-hour cache), `src/lib/scienceClient.ts` |
| Caching | `src/lib/cache.ts` — in-process Map in front of a `public.api_cache` table; degrades to memory-only if Postgres is unavailable |
| Retries | `src/lib/retry.ts` — exponential backoff with full jitter, transient failures only |
| Tracing | `src/lib/trace.ts` — one `agent_traces` row per LLM call, one `agent_tool_calls` row per tool call, sharing a `request_id` |
| Rate limiting | `src/middleware/rateLimit.ts` — per-user **and** per-IP fixed-window counters in Postgres; three buckets sized from what each route costs; fails open (ADR-008) |
| Idempotency | `src/middleware/idempotency.ts` — optional `Idempotency-Key` on the three expensive mutations; replays the stored response, rejects a reused key with a different body |
| Metrics | `src/lib/metrics.ts` + `src/routes/metrics.ts` — p50/p95/p99, error and cache-hit rates computed in SQL from the tracing tables; behind an env allow-list |
| Error reporting | `src/lib/observability.ts` — Sentry, inert without a DSN, with request bodies and GenAI inputs/outputs stripped |
| Tests | Vitest (`npm test`), **298 cases**; 113 of them run against real PostgreSQL 17 + pgvector 0.8 in-process (PGlite), the rest inject or mock the model client, `fetch` and the pg pool. No test needs the network or an API key. |
| Dev tooling | `scripts/agent-cli.ts` (run the agent and print its trace), `scripts/adversarial.ts` (the failure-mode suite) |

Every path that touches Postgres is **best-effort**: a failed cache or trace
write logs once and the request still succeeds.

### `science/` — Python + FastAPI (internal)

| Module | Purpose |
|---|---|
| `orbital.py` | Six hand-written orbital-mechanics formulas, each returning values, intermediates and the governing formula string ([ADR-003](decisions/ADR-003-deterministic-physics-engine.md)) |
| `iss.py` | Celestrak TLE fetch (1-hour cache) + SGP4 propagation + TEME→ECEF→topocentric frames for ISS position and ground-station pass prediction |
| `places.py` | 84-city gazetteer so "over Toronto" becomes coordinates without a geocoding dependency |
| `main.py` | Thin Pydantic-validated routes over the above |

138 pytest cases, all offline: the TLE is a committed fixture whose position was
cross-checked against an independent SGP4 service to 0.1 km.

## Data model

Fourteen tables across migrations 001–004. Highlights:

- `users` references `auth.users(id)` so auth identity and app data share an id.
- `papers` / `paper_chunks` for the RAG pipeline. `embedding` is **`vector(768)`**
  (migration 003) — not the model's native 3072, because pgvector cannot index
  above 2000 dimensions (ADR-006 §5). `page` **and** `page_end`, because a chunk
  crosses pages and a citation must not lie; `section_index` for document order;
  a generated `content_tsv` with a GIN index for the keyword half of retrieval.
- `paper_threads` / `paper_messages` — per-paper Q&A, with the citations stored
  on the assistant turn so a claim can be re-checked later.
- `agent_traces` — one row per LLM call; `agent_tool_calls` — one row per tool
  call. Both are deliberately free of foreign keys so a request that fails early
  still records, and both deliberately store **no prompt or answer text**.
- `eval_runs` / `eval_results` — conditions under test, and what happened.
- `api_cache` — keyed jsonb with `expires_at`.
- `rate_limit_counters` — fixed-window counts, PK `(bucket, key, window_start)`,
  one atomic upsert per request.
- `idempotency_keys` — a stored body hash, so a reused key with a different body
  is rejected rather than silently answered (ADR-008 §3).
- **RLS is enabled on every table with no policies**: deny-all through Supabase's
  public API. Only the API's service-role connection reads or writes.

## Request flow: the agent

```
POST /api/agent/solve
  │ requireAuth  → Supabase JWT verified against JWKS
  │ Zod          → problem is 1..4000 chars
  │ guardrail    → injection patterns redacted, text wrapped as <untrusted-problem>
  ├─ PLAN        1 model call, no tools. in_domain verdict + written plan.
  │                 └─ out of domain → refuse here, before spending a tool call
  ├─ TOOL LOOP   ≤6 rounds, ≤10 calls, 90 s budget
  │                 each call: coerce args → Zod → timeout race → backoff on
  │                 transient failure → scrub result → record trace row
  └─ SYNTHESIZE  1 model call constrained to the answer contract, given only the
                 collected results; numeric grounding check flags any value that
                 no tool produced
  → 200 { answer, plan, trace, meta }
```

## Build & deploy

| Package | Build | Run | Host |
|---|---|---|---|
| `web` | `vite build` → `dist/` | static | Vercel (SPA rewrite in `vercel.json`) |
| `api` | `esbuild → dist/server.cjs` (CJS, `--packages=external`) | `node dist/server.cjs` | Render |
| `science` | Docker (`python:3.12-slim`) | `uvicorn main:app` | container host |

`docker-compose.yml` runs `api` + `science` together for local integration work.
CI (`.github/workflows/ci.yml`) runs lint, typecheck, build and tests for all
three packages.

## Key design decisions

1. **Secrets never reach the browser.** Gemini and NASA keys are server-side; the
   client sees only `/api/*`.
2. **The physics engine is ground truth.** The LLM orchestrates and explains; it
   never computes a number that reaches the user (ADR-003, ADR-005).
3. **The agent is inspectable by default.** The full trace ships in the API
   response, not just to a log, because a trace that needs database access is not
   one anybody reads.
4. **Structured output via `responseSchema`** rather than prose parsing, for the
   agent contract and the older feature endpoints alike.
5. **Imperative Three.js over react-three-fiber** on the landing page — a faithful
   port of a vanilla-JS design bundle; R3F would add indirection with no benefit
   for a fire-and-forget cinematic.
6. **One database.** pgvector, cache and traces all live in the same Postgres
   (ADR-002); no Redis, no second vector store.

## Known gaps

Tracked rather than hidden.

- **Latency.** Three model calls per agent request; measured p50 13 s and one
  228 s outlier during a demand spike. The engine itself is 1.64 ms and the whole
  API layer 8.8 ms, so this is architectural — ADR-005 records the revisit trigger
  (collapse plan and tool phases) and its cost (the pre-tool refusal is lost).
  See [load-test.md](load-test.md).
- **`WEB_ORIGIN` is not required in production**, so a misconfigured deploy opens
  CORS. The one open medium-severity item in
  [security-review.md](security-review.md) (A05).
- **The global JSON body limit is 20 MB** on every route, not only the image and
  PDF endpoints that need it.
- **No durable client state** — notes and telemetry are React state and reset on
  refresh. The schema exists; the wiring does not.
- **No alerting.** Sentry reports errors; nothing reports "p95 doubled".
- **No OCR**, so scanned PDFs are rejected outright. Equations extract as
  fragments and table structure is lost
  ([rag-ingestion-findings.md](rag-ingestion-findings.md)).
- `POST /api/solve` still asks the model to do physics; superseded by the agent
  and scheduled for removal.
- `NasaExplorer.tsx` still renders curated static data instead of calling the
  live NASA tools the API now exposes.
