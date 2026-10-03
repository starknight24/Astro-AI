# Security

Honest current posture. The full OWASP Top-10 audit trail — what was checked,
found and fixed — is in [security-review.md](security-review.md). This page is
the summary.

## What is in place

| Control | Where |
|---|---|
| **Authentication on every `/api/*` route** | `api/src/middleware/auth.ts` — `jose` verifies a Supabase-issued JWT against the project's JWKS. Verified: an unauthenticated or malformed-token request to any `/api/*` route returns `401 {"error":"Unauthorized"}`. |
| **Deny-all row-level security** | Migrations 001/002 enable RLS on all ten tables with **no policies**, so Supabase's public anon key can read nothing. Only the API's service-role connection touches data. |
| **Secrets are server-side only** | `GEMINI_API_KEY`, `NASA_API_KEY` and `DATABASE_URL` live in `api/.env` / the host's secret store. The browser holds only the public Supabase URL and anon key. `.env*` is gitignored; only `.env.example` (names, no values) is tracked. |
| **Keys kept out of error paths** | The NASA client puts the API key in a query parameter and never echoes the URL into an error message — asserted by a test (`nasa.test.ts`, "never puts the api key in an error message"). |
| **Parameterised queries everywhere** | Every `pool.query` uses `$1`-style placeholders; no string-concatenated SQL exists in the codebase. |
| **Input validation at both boundaries** | Zod in `api/` (per route and per agent tool), Pydantic in `science/`. Deliberate duplication — each service defends its own door. |
| **Generic 500s** | Route handlers log the real error and return a fixed message plus a `request_id`. A test asserts a connection string in a thrown error does not reach the client. |
| **Fail fast in production** | The server exits if `GEMINI_API_KEY` is missing under `NODE_ENV=production`; `SCIENCE_URL`, `DATABASE_URL` and `SUPABASE_URL` are required at import time. |
| **The science service is not public** | Only the API talks to it (`SCIENCE_URL`); it holds no secrets and no user data. |

## Prompt injection

The agent takes untrusted text (problem statements) and untrusted third-party
content (NASA responses, and shortly PDF text) into a model's context. The
defence is layered and does not claim to be a solution — see
[ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md) §2 and the measured
behaviour in [failure-modes.md](failure-modes.md).

The load-bearing property is **blast radius, not filtering**: a tool call is only
reachable through the Zod-validated registry, so the worst a successful injection
achieves is a wrong *answer* — never a shell, a database write, an outbound
request to an attacker's host, or a secret in the response. On top of that:

1. Untrusted text is wrapped in `<untrusted-problem>` / `<untrusted-tool-results>`
   delimiters and the system instruction states that content inside them is data.
2. Imperative patterns (ignore-previous, role reassignment, system-prompt spoofing,
   secret extraction, guardrail bypass, citation fabrication) are **redacted and
   recorded** in the trace, so a suspicious answer is traceable to its cause.
3. **Tool output is scrubbed too** — not hypothetical: the place gazetteer echoes
   an unknown place name into its error message, so user text round-trips through
   a tool result.
4. No secret is ever placed in the model's context, so "print your API key" has
   nothing to print.

Known limit: the pattern list will miss novel phrasings. It is defence in depth
behind the registry boundary, not the control the design relies on.

## Added in Week 7

| Control | Detail |
|---|---|
| **Per-user and per-IP rate limiting** | Fixed-window counters in Postgres, three buckets: `api` 300/min, `agent` 10/hour, `upload` 10/hour. The agent bucket is sized so its allowance stays below one day of free-tier model quota. Both dimensions are checked, so neither one account nor one host can exceed it. Fails **open** — see below. 19 tests against real Postgres, including atomic increments under 10-way concurrency. |
| **Idempotency keys** | `Idempotency-Key` on `POST /api/papers`, `POST /api/papers/:id/ask` and `POST /api/agent/solve`. A retry replays the stored response; a concurrent duplicate gets `409`; the **same key with a different body gets `422`** rather than silently answering the wrong question. A 5xx is recorded as `failed` so a retry may try again. 28 tests. |
| **`trust proxy` in production** | Without it `req.ip` was Render's proxy, so per-IP limiting would have bucketed every user in the world into one counter. |
| **Terminal error handler** | An unhandled route error returned Express's default HTML stack trace; it now logs, reports to Sentry, and returns a generic JSON error. `unhandledRejection` is wired too. |
| **Sentry, API and SPA** | Inert without a DSN. Request bodies, headers, cookies, query strings, user info and GenAI inputs/outputs are all disabled at the SDK level **and** stripped in `beforeSend`. |
| **Dependency scanning** | `npm audit --omit=dev --audit-level=moderate` in CI for both packages, plus Dependabot weekly for npm and pip. |
| **5 vulnerabilities fixed** | Including two high severity: a react-router CSRF bypass and a `js-yaml` quadratic-CPU DoS. Production dependencies now report **0 vulnerabilities**. |
| **Metrics behind an allow-list** | `/api/admin/metrics` requires an explicit user id in `ADMIN_USER_IDS`; unset disables the route entirely, returning `404` (not `403`, which would confirm it exists). |

### Fail-open, deliberately

Rate limiting and idempotency both **allow the request** if their Postgres store
is unreachable, logging the failure. A database blip should not lock every student
out of a tutoring app, and the spend risk is already bounded by authentication —
every `/api/*` route needs a verified JWT, so an attacker needs an account before
they can cost anything. The accepted cost is that a Postgres outage is also a
rate-limit outage. Tested explicitly (*"fails OPEN when the store is unreachable"*).

## Still not fixed

| Gap | Risk | Status |
|---|---|---|
| **Permissive CORS fallback** | `cors({ origin: process.env.WEB_ORIGIN ?? true })` allows any origin when `WEB_ORIGIN` is unset. Production sets it, but a misconfigured deploy opens up silently — and ADR-001 records an incident already caused by this variable. | **Next task.** Fail fast in production, the same treatment `GEMINI_API_KEY` gets. Deliberately not done under a deadline so it can be deployed with attention. |
| **Global 20 MB JSON body limit** | Applied to every route, not only the image and PDF endpoints that need it — a memory-pressure vector. | Open. Per-route limits with a ~100 kB default. |
| **No `helmet`, no CSP** | Default Express headers. | Accepted: the API serves only JSON to a separate origin, so helmet's headers protect HTML this service does not return. CSP belongs at Vercel's edge. |
| **Body parsing precedes auth** | A malformed JSON body returns `400` before the `401`, confirming a route exists to an unauthenticated caller. | Open, low severity — route names are in this public repo anyway. |
| **No spend cap on the Gemini key** | Nothing external bounds cost if rate limiting is bypassed. | Open — needs a budget alert in the Google console, which is a console action rather than code. |
| **vitest mocker path traversal (dev)** | Moderate, dev-only; needs a major bump to vitest 5. | Accepted: the exploit requires code already running in the test process, which is code we wrote. |
| **No alerting** | Sentry reports errors; nothing reports "p95 doubled". | Open. |

## Data handling

Stored per user: Supabase `auth.users` identity (email), a `users` row, and —
once the RAG pipeline lands — uploaded papers and their chunks. Agent traces
store a loose `user_id`, the route, token counts and latency; **they do not store
prompt or answer text**, which keeps student problem statements out of the
observability tables.

## Operational rules

1. **Never** commit `.env`. Keys live in the host's secret store.
2. Rotate `GEMINI_API_KEY` if it appears in a log, paste or screenshot.
3. Set a spending cap / budget alert on the Google account before public launch.
4. Migrations are additive and idempotent; review any `ALTER` against a table
   that holds data before running it.

## Reporting

No formal disclosure process pre-launch. Add `security.txt` and a contact
address once the project is public.
