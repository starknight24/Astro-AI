# Security Review — OWASP Top 10 (2021)

Week 7 review of the actual code, not a checklist copied from elsewhere. Each
item records what was checked, what was found, and what was done. Findings that
are **not** fixed say so and say why.

Reviewed at commit `4b9b93d` + the Week 4–7 working tree. Current posture
summary lives in [SECURITY.md](SECURITY.md); this is the audit trail.

**Outcome: 7 issues found, 5 fixed, 2 accepted with stated reasoning.**

---

## A01 · Broken Access Control

**Checked:** every route's authorisation, and whether one user can reach
another's data.

| Surface | Control | Verified by |
|---|---|---|
| All `/api/*` | `requireAuth` — Supabase JWT verified against JWKS | `curl` with no token and with a malformed token → `401` on both; `GET /api/agent/tools`, `POST /api/agent/solve`, `POST /api/calculate/period` all checked |
| Papers | every query filters `user_id = $1` | `pipeline.test.ts` → *"refuses to answer about another user's paper"*, *"does not deduplicate across users"* |
| Threads | `paper_threads` carries `user_id`; a thread id from another paper is rejected | `pipeline.test.ts` → *"rejects a thread id belonging to a different paper"* |
| Chunk retrieval | scoped by `paper_id`, which is scoped by `user_id` | `store.test.ts` → *"scopes retrieval to one paper"* |
| Database (direct) | RLS enabled on all **14** tables with **no policies**, and zero `CREATE POLICY` statements exist → deny-all through Supabase's public API | migrations 001–004, verified mechanically |
| `/api/admin/metrics` | explicit user-id allow-list; **unset disables the route** | `routes/metrics.ts` |

**FIXED — admin metrics returns 404, not 403.** A `403` confirms the route
exists to anyone who probes it. `404` for both "not an admin" and "admin not
configured" leaks nothing. Failing closed on an unset allow-list means a
misconfigured deploy hides the endpoint rather than publishing cost data.

**No IDOR found.** Paper and thread ids are UUIDs and every lookup is joined to
the caller's `user_id`; a guessed id returns `404`.

---

## A02 · Cryptographic Failures

**Checked:** what secrets exist, where they live, and whether any can leak.

- `GEMINI_API_KEY`, `NASA_API_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  are server-side only. The browser gets the Supabase URL and the publishable
  anon key, which are public by design.
- `.env*` is gitignored with only `.env.example` tracked; `git log -p` shows no
  key ever committed.
- `grep` for `sk-`, `AIza`, `eyJhbGciOi`, `service_role` across `api/src`,
  `web/src`, `science/*.py` → **no matches**.
- `grep` for `console.*(process.env)` → **no matches**.
- JWTs are verified with RS256 against the remote JWKS. No secret-key
  verification, no `alg: none` path, no local signing in production code.

**FIXED (Week 4) — the NASA key could have reached an error message.** The client
builds a URL with `api_key` in the query string. Error messages now name the path
only (`NASA /planetary/apod responded 403`), never the URL. Asserted by
`nasa.test.ts` → *"never puts the api key in an error message"*.

**FIXED (Week 7) — Sentry could have exported the key and student text.** Error
reporting ships request context by default. `dataCollection` disables user info,
cookies, headers, bodies, query params and GenAI inputs/outputs, and `beforeSend`
strips them again; `beforeBreadcrumb` drops HTTP breadcrumb URLs, which is where
a NASA key would otherwise appear. Belt and braces deliberately: the flags are
configuration, the scrubber is code.

---

## A03 · Injection

### SQL

**Every** query uses parameter placeholders. Verified mechanically:
`grep -rE "query\(\s*[\`\"'].*\$\{"` across `api/src` → **no matches** (no
template interpolation into SQL). 18 query call sites, all `$1`-style.

The one place SQL is built dynamically is the multi-row chunk insert in
`store.ts`, which generates `($1, $2, …)` *placeholder tuples* and passes values
separately — the generated text contains no data.

### Prompt injection

Treated as a first-class threat with its own measured test suite
([failure-modes.md](failure-modes.md) §5) rather than a checklist line. Four
live adversarial cases pass, including one where the attack arrives through
**tool output** rather than user input.

The load-bearing control is **blast radius, not filtering**: a tool call is only
reachable through the Zod-validated registry, so a successful injection produces
a wrong *answer* — never a shell, a database write, an outbound request to an
attacker's host, or a secret in the response. No secret is in the model's
context, so "print your API key" has nothing to print.

### Command injection

No `exec`, `execSync`, `spawn` with a shell, or `eval` anywhere in `api/src` or
`science/*.py`. The one `spawn` in the repo is in `evals/run_physics.py`, a
developer tool, with an argument array and no shell.

---

## A04 · Insecure Design

**Checked:** where the design itself creates risk.

- **Cost as a security property.** The agent spends three metered model calls per
  request. Before Week 7 an authenticated user could loop it without bound. Now
  rate-limited to 10/hour/user — chosen so the limit is below one day of
  free-tier model quota rather than being a round number.
- **Fail-open vs fail-closed**, decided per control and documented:
  rate limiting and idempotency **fail open** (a database blip must not lock
  students out, and auth already bounds who can spend anything); the admin
  metrics route **fails closed** (no allow-list → no route).
- **The model is never trusted with arithmetic** (ADR-003) or with citations
  (ADR-006 §7). Both are enforced in code, not requested in a prompt.

---

## A05 · Security Misconfiguration

**FIXED — `trust proxy` was unset.** Behind Render's proxy, `req.ip` was the
proxy's address, so per-IP rate limiting would have bucketed every user in the
world into one counter. Now `app.set("trust proxy", 1)` in production only —
setting it in development would let a local client spoof `X-Forwarded-For`.

**FIXED — an unhandled route error returned Express's default HTML stack trace.**
A terminal error handler now logs the real error, reports it to Sentry, and
returns `{"error": "The request could not be completed."}`. `process.on('unhandledRejection')`
is also wired, so a stray rejection is reported instead of vanishing.

**NOT FIXED — no `helmet`, no CSP.** Accepted for now: the API serves only JSON
to a separate origin, so the headers helmet sets (`X-Frame-Options`,
`X-Content-Type-Options`, CSP) protect HTML responses this service does not
return. The SPA is served by Vercel, where CSP belongs at the edge. Recorded as
open rather than silently skipped.

**FIXED (2026-10-11) — permissive CORS fallback.** `cors({ origin: process.env.WEB_ORIGIN ?? true })`
allowed any origin when `WEB_ORIGIN` was unset. Production set it, but a
misconfigured deploy opened up silently, and ADR-001 already records an incident
caused by this variable.

Production now refuses to start without it, alongside the other variables whose
absence is silent damage rather than an obvious failure:

```
GEMINI_API_KEY  the agent and RAG answerer cannot run without it
WEB_ORIGIN      CORS would otherwise reflect any origin
DATABASE_URL    traces, rate limits and idempotency all need it
SCIENCE_URL     every physics tool call goes through it
```

Development still falls back to reflecting any origin, which is deliberate:
there is no cookie or token on a developer's machine that an attacker's page
could borrow, and requiring the variable locally would be friction with no
security gain.

---

## A06 · Vulnerable and Outdated Components

**FIXED — 5 vulnerabilities, including 2 high severity.**

| Package | Severity | Issue | Action |
|---|---|---|---|
| `react-router` / `react-router-dom` | **high** | CSRF bypass allowing action execution before a 400 response (RSC mode) | upgraded (`npm audit fix`) |
| `qs` (via `express`) | moderate | array-limit bypass; DoS via attacker-controlled `isBuffer` | upgraded |
| `body-parser`, `express` | moderate | transitive on `qs` | upgraded |
| `brace-expansion` (dev) | **high** | DoS via unbounded expansion → OOM crash | upgraded |
| `js-yaml` (dev) | **high** | quadratic CPU in `!!omap` resolution (CVE-2026-59870 not backported) | upgraded |

**Production dependencies: `npm audit --omit=dev` reports 0 vulnerabilities** in
both `api` and `web`.

**NOT FIXED — 2 moderate, dev-only.** `vitest` / `@vitest/mocker` path traversal
via a redirect mock, fixable only by a **major** bump to vitest 5. The exploit
requires code already running inside the test process, which is code we wrote; the
risk is nil and a major test-runner upgrade risks 298 passing tests for no
security gain. Revisit when upgrading vitest for other reasons.

**NOT FIXED — no automated dependency scanning.** `npm audit` is not yet in CI
and Dependabot is not enabled, so this review is a snapshot rather than a
standing control. That is the single biggest remaining gap in this category.

---

## A07 · Identification and Authentication Failures

- Authentication is delegated to Supabase: no password handling, no session
  management, no reset flow in this codebase — a large class of bugs that cannot
  occur here.
- Token verification uses `jose` with a remote JWKS; signature, expiry and
  `sub` are all checked, and a token missing `sub` is rejected.
- **No test-only auth bypass exists.** Load testing needed authenticated
  requests; rather than adding a bypass flag, `api/scripts/local-auth.mjs` serves a
  JWKS and mints a real RS256 token so the production middleware runs unmodified.
  A bypass would have been a standing invitation to ship it by accident.
- `upsertUser` failures are logged and ignored, so a database outage degrades to
  "no user row" rather than "nobody can log in".

---

## A08 · Software and Data Integrity Failures

- No dynamic code loading, no `eval`, no remote module fetching.
- Uploaded PDFs are validated: a `%PDF-` magic-byte check at the API, a 15 MB cap
  at both the API and the science service, a page cap, and extraction that fails
  loudly on an unreadable file rather than guessing.
- **Citation integrity is enforced in code** (ADR-006 §7): every page a model
  cites is checked against the chunk it claims, and an answer whose citations all
  fail verification is downgraded to a refusal. `rejected_citations` is reported
  so a tampering attempt is visible rather than silent.
- Migrations are additive and idempotent; migration 003 **refuses to run** if it
  would discard embeddings of the wrong dimension rather than silently dropping
  them.

---

## A09 · Security Logging and Monitoring Failures

- **FIXED — Sentry integrated** in both API and SPA, inert without a DSN.
- `agent_traces` (one row per LLM call) and `agent_tool_calls` (one per tool
  call) record outcome, latency, tokens and retry attempts, joined by
  `request_id`.
- Rate-limit violations are logged with the key that tripped and the route; the
  key is **not** returned to the client (asserted by a test).
- `/api/admin/metrics` surfaces p50/p95/p99, error rates, tool failure rates and
  cache hit rates.
- **Deliberate omission: prompt and answer text are never logged or stored.**
  Not an oversight — a student's problem statement is the content of the product,
  and keeping it out of the observability path is why `agent_traces` has token
  counts but no text, and why Sentry's `beforeSend` strips bodies.

**Gap:** no alerting on the metrics, and no uptime check. Sentry will report
errors; nothing yet reports "p95 doubled".

---

## A10 · Server-Side Request Forgery

**Checked:** every outbound request and whether a user can influence its target.

| Call | Target | User-controllable? |
|---|---|---|
| `postToScience` / `getScience` | `SCIENCE_URL` + a **hard-coded** path | No — paths are literals in `tools.ts`, never built from input |
| NASA client | `https://api.nasa.gov` + hard-coded path | No — `date` and `asteroid_id` are regex-validated (`^\d{4}-\d{2}-\d{2}$`, `^\d{1,12}$`) and go in query parameters |
| Celestrak TLE | one hard-coded URL | No |
| Supabase Storage | `SUPABASE_URL` + bucket + a path built from `userId` + a SHA-256 hex digest | No — both components are server-generated |
| JWKS | `SUPABASE_URL` | No |

**No URL anywhere is constructed from user input**, so the classic SSRF shape
does not exist. The place to watch is the agent: it chooses *which* tool to call,
but every tool's target is a literal, so the worst it can do is call the wrong
one of four fixed endpoints.

One sharp edge worth naming: `iss_position` accepts a `place` string that reaches
the gazetteer, and the gazetteer echoes unknown names back in its error message.
That is the tool-output injection path tested in
[failure-modes.md](failure-modes.md) §E4 — not SSRF, since no request is built
from it, but it is the one place user text crosses a service boundary.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A05 | `trust proxy` unset → per-IP limits bucket all users together | medium | **fixed** |
| A05 | unhandled route errors returned an HTML stack trace | medium | **fixed** |
| A06 | react-router CSRF bypass | **high** | **fixed** |
| A06 | `brace-expansion` / `js-yaml` DoS (dev) | **high** | **fixed** |
| A06 | `qs` / express DoS and array-limit bypass | moderate | **fixed** |
| A01 | admin metrics would confirm its own existence via 403 | low | **fixed** (404) |
| A02 | Sentry would have exported request bodies and the NASA key | medium | **fixed** before first deploy |
| A05 | no `helmet` / CSP | low | **accepted** — JSON-only API; CSP belongs at Vercel's edge |
| A05 | CORS allows any origin when `WEB_ORIGIN` is unset | medium | **fixed** — production fails fast without it |
| A06 | vitest mocker path traversal (dev) | moderate | **accepted** — needs a major bump; exploit requires our own test code |
| A06 | no `npm audit` in CI, no Dependabot | medium | **open** — largest remaining gap |
| A09 | no alerting or uptime check | low | **open** |

## How to re-run this review

```bash
# dependency advisories, production only
cd api && npm audit --omit=dev
cd web && npm audit --omit=dev

# SQL built by interpolation (expect no matches)
grep -rE 'query\(\s*[`"'"'"'].*\$\{' api/src --include='*.ts'

# secrets or env dumped to logs (expect no matches)
grep -rnE '(sk-|AIza|eyJhbGciOi|service_role)' api/src web/src science/*.py
grep -rnE 'console\.(log|error|warn).*process\.env' api/src --include='*.ts'

# authorisation and injection behaviour
cd api && npx vitest run            # 298 tests
cd api && npx tsx scripts/adversarial.ts   # 18 live adversarial cases
```
