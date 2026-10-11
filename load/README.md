# Load tests (k6)

Five scenarios, one per layer, so a bottleneck can be attributed rather than
guessed at:

| Script | Endpoint | What it isolates |
|---|---|---|
| `calculator.js` | `POST /api/calculate/period` | the api→science hop and the deterministic engine — no LLM at all |
| `science-direct.js` | `POST :8000/calculate/period` | the engine alone, bypassing the API — subtract from `calculator.js` to price the API layer |
| `api-layers.js` | `GET /health`, `POST /api/calculate/period` | auth, rate limiting and the DB round trips, by differencing an unauthenticated route against an authenticated one |
| `rag.js` | `POST /api/papers/:id/ask` | embeddings + pgvector retrieval + one model call |
| `agent.js` | `POST /api/agent/solve` | the full three-call agent loop |

## Running them

```bash
# 1. The stack must be up: science service, API, and a reachable database.
cd science && ./.venv/bin/uvicorn main:app --port 8000 &
cd api && npm run dev &

# 2. A token. Every /api route requires one.
export API_URL=http://localhost:3001
export TOKEN="$(node api/scripts/local-auth.mjs --ttl 36000)"   # see below

# 3. Run one scenario
k6 run load/calculator.js
k6 run -e PAPER_ID=<uuid> load/rag.js
k6 run load/agent.js
```

Getting a token: run `api/scripts/local-auth.mjs`. It serves a JWKS on :8899 and
prints one RS256 token on stdout. Point the API at it with
`SUPABASE_URL=http://127.0.0.1:8899` and the **real, unmodified** `requireAuth`
verifies against it — jose, the JWKS fetch, its cache and the signature check all
run as they do in production. That is deliberately better than a test-only auth
bypass, which would measure a code path that does not exist in production. The
keypair is generated per run and never written to disk.

It lives under `api/scripts/` rather than next to the k6 scripts because Node
resolves bare imports from the file's own location: in `load/` it would never
find `jose`, which is an `api` dependency.

Against a deployed environment instead, use a real Supabase access token: sign in
to the web app and read `(await window.__supabase.auth.getSession()).data.session.access_token`
from the browser console on `/app`. Those are short-lived, so a long run needs a
fresh one.

## Why the scenarios are shaped this way

**The calculator is the only endpoint that can be pushed hard.** It is
deterministic, microseconds of CPU, and its only dependency is the science
service — so it measures *our* code. It gets a ramping arrival rate up to 50
requests/second.

**The agent and RAG scenarios are deliberately small** — single-digit virtual
users. Not timidity: the agent spends three model calls per request against a
free tier that allows 20 per day, so a 50-VU agent test would spend the entire
daily budget in under a second and then measure nothing but 429s. The rate limits
from Week 7 (10 agent requests/hour/user) would stop it even sooner, and
correctly so. What these scenarios can establish is **where the time goes under
light concurrency**, which is the question that matters when a single request
already takes tens of seconds.

That asymmetry is the honest finding: this system's latency is not a concurrency
problem, it is a dependency-latency problem. Results and the bottleneck analysis
are in [`docs/load-test.md`](../docs/load-test.md).

## Thresholds

Each script sets `thresholds` so a run fails rather than merely reporting:

- `http_req_failed` — the 5xx rate. A load test that ends in a 5xx storm is a
  failed test, which is the Week-7 exit criterion.
- `http_req_duration{expected_response:true}` — p95 on successful requests, so a
  fast 429 cannot flatter the percentile.

429s are expected under load and are **not** counted as failures: being rate
limited is the system working. They are tracked in a separate counter.
