# ADR-008: Hardening & Operational Decisions

**Status:** Accepted · **Date:** 2026-10-02

## Context

Week 7 added the controls that make the system safe and legible to run: rate
limiting, idempotency, a metrics surface, error reporting, and load testing. Each
had a real choice behind it, and none was interesting enough to deserve its own
ADR — but together they are the operational posture of the system, and a reader
asking "why fail open?" or "why not Grafana?" deserves an answer in one place.

This is also the Week-8 sweep, so it records the decisions that were made in code
without being written down. [ADR-004](ADR-004-authentication.md) was the other
gap the sweep found and got its own file, because authentication is load-bearing
enough to deserve one.

## Decisions

### 1. Rate limiting: fixed-window counters in Postgres

**Store.** Postgres, one atomic upsert per request. Per-user limits must hold
across instances, and an in-memory counter on a two-instance deploy silently
doubles every limit. Postgres is already the shared store ([ADR-002](ADR-002-pgvector-vs-pinecone.md)),
and one indexed upsert is cheap next to the three model calls the limit protects.
**Measured: 0.90 ms per round trip** — 0.007% of a 13-second agent request.

Redis would be faster and is what this is "supposed" to use. Rejected for the
same reason as the response cache: a third service for a counter is more
operational surface than the problem deserves at this scale.

**Fixed window, not sliding.** A sliding window needs either a sorted set of
timestamps per key or a second table. The cost of a fixed window is that a caller
can burst across a boundary — up to 2× the limit in one instant. For protecting a
metered API budget over minutes and hours that is acceptable; for anything
security-critical it would not be, and this is written down so nobody later
assumes it is stronger than it is.

**Both dimensions, always.** Per-user catches one account looping; per-IP catches
many throwaway accounts behind one host. Checking only one leaves the other open.

**Limits derived from cost, not round numbers:**

| Bucket | Limit | Why that number |
|---|---|---|
| `api` | 300/min | Dominated by the deterministic calculator at 1.64 ms. Generous on purpose. |
| `agent` | 10/hour | 3+ model calls each. 10 × 3 = 30 calls, already above the free tier's 20/day/model. |
| `upload` | 10/hour | PDF extraction plus an embedding call per 32 chunks. Covers a study session; 100 would be a scraper. |

### 2. Rate limiting and idempotency **fail open**

If the store is unreachable, the request is **allowed** and the failure logged.

A database blip must not lock every student out of a tutoring app, and the spend
risk is already bounded by [ADR-004](ADR-004-authentication.md): every `/api/*`
route needs a verified JWT, so an attacker needs an account before they can cost
anything. Rate limiting is a budget control layered on top of authentication, not
the thing keeping strangers out.

The accepted cost is explicit: **a Postgres outage is also a rate-limit outage.**
If the Gemini key ever became unmetered-but-expensive, or if the API became
anonymous, this trade would have to flip. Tested directly, so the behaviour
cannot drift: *"fails OPEN when the store is unreachable"*.

The one control that **fails closed** is `/api/admin/metrics`: an unset
`ADMIN_USER_IDS` disables the route entirely. The asymmetry is deliberate —
failing open on availability, closed on disclosure.

### 3. Idempotency hashes the request body

The key is scoped to `(key, user_id, route)` and stores a SHA-256 of the
canonicalised body. A replay with the **same key and a different body** is a
client bug — a reused key — not a retry, and returning the first response for it
would silently answer the wrong question and hide the bug. That case gets `422`.

Canonicalisation sorts object keys, so a client serialising the same object
differently is still recognised as the same request.

**A 5xx is recorded as `failed`, not `completed`.** Replaying a server error to
every retry would turn one transient fault into a permanent one. A 4xx *is*
replayed, because the answer will not change.

**The header is optional.** Requiring it would break the existing UI for no
safety gain on read-mostly routes. Paper uploads additionally dedupe on the
SHA-256 of the file ([ADR-006](ADR-006-chunking-and-retrieval.md)), so a client
that sends no key still cannot create a duplicate paper — the middleware is the
generic mechanism, the content hash is the domain-specific backstop.

### 4. Metrics: one endpoint over our own traces, not Grafana Cloud

The plan allowed either a minimal `/admin/metrics` page or a Grafana Cloud
integration. **Chosen: the endpoint.**

Grafana needs an exporter, a scrape target reachable from outside, an account and
dashboard definitions — infrastructure whose purpose is to display numbers that
`agent_traces` and `agent_tool_calls` can already answer in one SQL query. The
project principle is *simple + measurable + explainable*, and at one operator the
endpoint wins.

**Percentiles are computed in Postgres** with `percentile_disc`, not in Node:
pulling a day of traces over the wire to sort them in JavaScript to produce six
numbers is the wrong shape.

**Per-request latency is the sum of a request's LLM calls**, not any single row's
latency, because one agent request is three rows sharing a `request_id`. Getting
this wrong would have under-reported end-to-end latency by ~3×.

**No new instrumentation was added.** Everything comes from tables Week 4 already
wrote. If a question cannot be answered from them, that is a gap in the tracing
and the fix belongs there — not in a parallel metrics pipeline.

**`cache_hit_rate` is null, not 0, for tools that do not cache.** A physics call
that never caches must not read as a 0% hit rate; that is a false signal
masquerading as a measurement.

**Admin access is an env allow-list**, not a `role` column. There is one
operator. A role column plus a UI to manage it would be a feature nobody asked
for. The route returns `404` rather than `403`, so a prober does not learn it
exists.

### 5. Error reporting: Sentry, inert by default, text-free

`SENTRY_DSN` unset means no reporting, so development and CI need no account and
no network egress. A hard dependency on an external reporter would mean the
server could not start without one.

**Student text never leaves the process for debugging.** A problem statement and
a paper question are the *content of the product*, not telemetry. Request bodies,
headers, cookies, query strings, user info and GenAI inputs/outputs are disabled
at the SDK level **and** stripped again in `beforeSend`; HTTP breadcrumb URLs are
dropped because that is where a NASA API key would otherwise appear.

Belt and braces on purpose: the SDK flags are configuration a future change could
flip, while the scrubber is code. This is the same posture as `agent_traces`,
which records token counts and latency but no prompt text.

**`tracesSampleRate` is 0.05.** LLM latency and token counts are already recorded
exactly in `agent_traces`; paying a second vendor to re-measure them would be
duplication. Errors are the reason Sentry is here.

**Session Replay is off** in the SPA: it records the DOM, which contains the
student's questions and the paper they uploaded.

### 6. `trust proxy` only in production

Behind Render's proxy, `req.ip` is the proxy unless Express is told to trust
`X-Forwarded-For` — which would have bucketed every user in the world into one
per-IP counter. Enabling it in development would let a local client spoof the
header and evade its own limit, so it is gated on `NODE_ENV === "production"`.

### 7. Load testing: real auth, not a bypass

Measuring the authenticated path needed tokens. Rather than add a test-only auth
bypass, `api/scripts/local-auth.mjs` serves a JWKS and mints an RS256 token, so the
production middleware runs **unmodified**.

A bypass would have measured a code path that does not exist in production and
would have been a standing invitation to ship it by accident. This way the
measurement is of the real thing and there is nothing to accidentally enable.

### 8. The bottleneck was measured before it was fixed

The obvious guess was JWT verification. It is **0.05 ms** — negligible. The
actual cost was two database round trips per request at 0.90 ms each, one of
which (`upsertUser`) was a no-op after the first success. That one is now
memoised per process with a bounded, TTL'd map, recorded only on success so a
transient failure is retried.

The claim is **one fewer database round trip per authenticated request**, proven
by test (50 requests → 1 query), not by a latency graph: the expected saving
(~0.9 ms) is below the measured run-to-run noise floor on that path (1.80 ms).
An earlier attempt appeared to show the change making things *worse*, while the
untouched Express baseline also moved — which is how the noise was caught instead
of published. Details in [load-test.md](../load-test.md).

**The finding that matters is that none of this matters.** The API layer is
~8.8 ms of a 13,000 ms agent request. The real bottleneck is three model calls,
and ADR-005 already records the revisit trigger for collapsing two of them.

## Consequences

The system can be run and reasoned about: limits are enforced and visible in
response headers, retries are safe, latency and cost are queryable, errors are
reported without exporting anyone's words, and the performance claims are
measurements with stated denominators.

**Costs accepted:** a fixed window permits boundary bursts; fail-open means a
Postgres outage removes the budget control; the metrics endpoint has no alerting,
so Sentry reports errors but nothing reports "p95 doubled"; and the admin
allow-list does not scale past a handful of operators.

**Revisit triggers:** add Redis if rate-limit upserts ever appear in a latency
profile (they do not today — 0.90 ms against 13 s). Switch to fail-closed if the
API ever serves unauthenticated traffic. Add alerting before anyone other than
the author depends on the service being up.

## References

- [ADR-002](ADR-002-pgvector-vs-pinecone.md) (one database), [ADR-004](ADR-004-authentication.md) (auth bounds who can spend), [ADR-005](ADR-005-agent-loop-and-guardrails.md) (where the latency actually is), [ADR-006](ADR-006-chunking-and-retrieval.md) (content-hash dedupe), [ADR-007](ADR-007-eval-design.md) (why outages are excluded from metrics)
- [load-test.md](../load-test.md) — the measurements · [security-review.md](../security-review.md) — the OWASP audit trail
