# Deployment

What it takes to put the current system in production. The previous version of
this file described a single Express service serving the SPA; that stopped being
true in Week 1 when the repo split into three packages
([ADR-001](decisions/ADR-001-service-topology.md)).

## Current state

| | |
|---|---|
| **API** | <https://astro-ai-ri7l.onrender.com> — responding, but running a build that **predates Weeks 4–7** |
| **Web** | Vercel, from `web/` |
| **Science** | **not deployed** — the API's `SCIENCE_URL` has nowhere to point in production |
| **Database** | the Supabase project is currently unreachable (its host does not resolve) |

So the agent, the RAG pipeline, rate limiting, metrics and Sentry are committed
and tested locally but **not live**. The blockers are a restored database and a
deployed science service, in that order.

---

## Three services, three targets

```
web/      → Vercel         static build, SPA rewrite already in web/vercel.json
api/      → Render         Node service, the only public entry point
science/  → Render/Fly     container, INTERNAL — must not be publicly reachable
```

`science/` holds no secrets and no user data, but it will chunk any PDF posted to
it and propagate any TLE, so it belongs on a private network or behind an
allow-list. The API is its only client.

## Order of operations

1. **Database.** Create (or restore) the Supabase project, then run
   `db/migrations/001` through `004` **in order** in the SQL editor. They are
   idempotent (`if not exists`) and additive. Migration 003 deliberately
   *refuses* to run if it would discard embeddings of the wrong dimension.
2. **Science service.** Deploy `science/` from its `Dockerfile`
   (`uvicorn main:app --host 0.0.0.0 --port 8000`). Note its internal URL.
   Health: `GET /health`.
3. **API.** Deploy `api/`. Build `npm ci && npm run build`, start
   `node dist/server.cjs`, health `GET /health`. **`NODE_ENV=production` must be
   set** — it is what enables `trust proxy`, without which per-IP rate limiting
   buckets every user into one counter, and what makes a missing
   `GEMINI_API_KEY` fail fast instead of booting with a mock.
4. **Web.** Deploy `web/` with `VITE_API_URL` pointing at the API's public URL.
5. **Smoke test** (below).

## Environment

Full list with explanations in [`.env.example`](../.env.example). The ones a
deploy fails without:

| Variable | Service | Consequence if wrong |
|---|---|---|
| `SUPABASE_URL` | api | required at import; JWT verification fetches its JWKS from here |
| `DATABASE_URL` | api | required at import. Cache, tracing, rate limiting and idempotency all degrade gracefully if it is merely *unreachable*, but it must be set |
| `GEMINI_API_KEY` | api | **the process exits** in production if unset |
| `SCIENCE_URL` | api | required at import; every physics call and PDF ingestion goes here |
| `WEB_ORIGIN` | api | ⚠️ if unset, CORS allows **any** origin. See the warning below |
| `NODE_ENV=production` | api | gates `trust proxy` and the fail-fast key check |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | web | sign-in fails |
| `VITE_API_URL` | web | the SPA calls relative URLs and gets its own origin |

Worth setting, not required:

| Variable | Effect |
|---|---|
| `NASA_API_KEY` | without it the agent uses NASA's shared `DEMO_KEY`, capped around 30 requests/hour/IP |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | error reporting; inert when unset |
| `ADMIN_USER_IDS` | **unset disables `/api/admin/metrics` entirely** (returns 404) |
| `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_STORAGE_BUCKET` | store the original PDFs; ingestion works without them |
| `GEMINI_INPUT_USD_PER_MTOK`, `GEMINI_OUTPUT_USD_PER_MTOK` | without these, `cost_usd` is recorded as `null` rather than a guessed figure |
| `GIT_SHA`, `VITE_GIT_SHA` | attached to Sentry events as the release |

> ⚠️ **`WEB_ORIGIN` is the known sharp edge.** `cors({ origin: process.env.WEB_ORIGIN ?? true })`
> allows any origin when unset, and ADR-001 records an outage already caused by
> getting this variable wrong. Making it fail fast in production is the one open
> medium-severity item in [security-review.md](security-review.md) (A05) and should
> be done before the next public deploy.

## Model quota is a deployment concern

Measured: the Gemini free tier allows **20 `generateContent` requests per day per
model**, and one agent request costs three. A deployed instance on a free key can
serve roughly **six agent requests per day** before every subsequent one returns
`insufficient_data` with a quota error in its trace.

The in-app rate limit (10 agent requests/hour/user) does not save you from this —
it bounds one user, not the project's daily total. Before anyone else uses the
deployment, either enable billing or expect the agent to be unavailable most of
the time. Set a spending cap in the Google console either way.

## Smoke test after deploying

```bash
API=https://your-api.example.com

# 1 · liveness, no auth
curl -s $API/health                                   # {"status":"ok"}

# 2 · auth is enforced (expect 401, not 200 and not 500)
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST $API/api/calculate/period \
  -H 'Content-Type: application/json' -d '{"altitude_km":400}'

# 3 · rate-limit headers are present on an authenticated call
curl -s -D- -o /dev/null -X POST $API/api/calculate/period \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"altitude_km":400}' | grep -i ratelimit

# 4 · the physics is right end to end: expect period_s ≈ 5553.62
curl -s -X POST $API/api/calculate/period \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"altitude_km":400}'

# 5 · the agent (slow: 13–45 s, and spends three model calls)
curl -s -X POST $API/api/agent/solve \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"problem":"What is the orbital period in minutes at 400 km?"}' \
  | python3 -m json.tool | head -40
```

Then check `/api/admin/metrics?format=text` as an admin user: if the tracing
tables are reachable it will show the request you just made, which confirms the
database write path as well as the read path.

## Rollback

Each service deploys independently, so roll back the one that broke. Migrations
are additive and never drop a column, so an API rollback does not require a
database rollback — the older code simply ignores the newer columns.

The exception is migration 003's `alter column embedding type vector(768)`. If you
roll back *past* Week 5, re-running an older migration will not undo it; nothing
breaks, because nothing older reads that column.
