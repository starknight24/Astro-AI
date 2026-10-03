# API Reference

Base URL is the `api/` service (Express). The React app calls it through
`web/src/lib/api.ts`, which attaches the Supabase access token.

**Every `/api/*` route requires authentication.** `requireAuth` verifies a
Supabase-issued JWT against the project's JWKS and puts `{ userId, email }` on
the request; a missing or invalid token is `401 {"error":"Unauthorized"}`. Two
routes are unauthenticated by design: `GET /` (service banner) and
`GET /health`.

Error shape is uniform:

```json
{ "error": "<message>", "details": [ … ] }
```

`details` appears on `400` responses from Zod-validated routes and carries the
failing field paths. `500` responses carry a generic message only — internals go
to the server log, never to the client.

---

## Rate limiting

Every `/api/*` route is rate limited per **user** and per **IP**; the stricter of
the two applies. Three buckets, sized from what each route costs
([ADR-008](decisions/ADR-008-hardening-and-operations.md) §1):

| Bucket | Routes | Limit |
|---|---|---|
| `api` | everything authenticated | 300 / minute |
| `agent` | `/api/agent/*` | 10 / hour |
| `upload` | `/api/papers/*` | 10 / hour |

Every response carries the draft RFC headers:

```
RateLimit-Limit: 300
RateLimit-Remaining: 297
RateLimit-Reset: 1790899560        ← unix seconds when the window ends
```

Exceeding a bucket returns `429` with `Retry-After` and:

```json
{ "error": "Rate limit exceeded for this agent allowance. Try again in 2841s.",
  "retry_after_seconds": 2841 }
```

The error never names which key tripped — that would tell a caller whether they
were limited by account or by address.

**The limiter fails open.** If its Postgres store is unreachable the request is
allowed and the failure logged: a database blip must not lock students out, and
authentication already bounds who can spend anything.

## Idempotency

`POST /api/agent/solve`, `POST /api/papers` and `POST /api/papers/:id/ask` accept
an optional `Idempotency-Key` header (8–200 characters).

| Situation | Response |
|---|---|
| First request with that key | handled normally; the response is stored |
| Retry, same key, **same** body | the stored response is replayed, with `Idempotent-Replay: true` |
| Retry while the first is still running | `409` with `Retry-After: 5` |
| Same key, **different** body | `422` — a reused key is a client bug, and replaying the first answer would hide it |
| First attempt returned 5xx | recorded as failed, so a retry runs again rather than replaying the error |

Paper uploads additionally dedupe on the SHA-256 of the file, so a client that
sends no key still cannot create a duplicate paper.

---

## Agent

### POST /api/agent/solve

The Week-4 agent: plan → tool call(s) → synthesize. See
[ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md) for the design and
[failure-modes.md](failure-modes.md) for its behaviour under adversarial input.

**Request**

```json
{
  "problem": "Calculate the orbital period of a satellite at 400 km and tell me when the ISS next passes over Toronto",
  "request_id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
}
```

| Field | Required | Notes |
|---|---|---|
| `problem` | yes | 1–4000 characters. Longer is `400`. |
| `request_id` | no | RFC-4122 UUID. Supplied so a client retry can be correlated in `agent_traces`. Generated when omitted. |

**Response** — `200` with the answer contract plus the full trace:

```json
{
  "request_id": "…",
  "status": "answered | insufficient_data | refused | error",
  "answer": {
    "status": "answered | insufficient_data | refused",
    "steps": [
      { "step": 1, "description": "…", "formula": "T = 2π·√(a³/μ)",
        "substitution": "a = 6778.137 km", "result": "5553.62 s", "tool": "orbital_calculator" }
    ],
    "formulas": ["T = 2π·√(a³/μ)"],
    "citations": [{ "tool": "orbital_calculator", "source": "AstroAI deterministic physics engine…", "detail": "period_s = 5553.62" }],
    "quantities": [{ "quantity": "orbital period", "value": 5553.62, "unit": "s" }],
    "final_answer": "…",
    "caveats": ["…"]
  },
  "plan": {
    "in_domain": true,
    "domain_reason": "…",
    "restated_problem": "…",
    "steps": ["…"],
    "tools_expected": ["orbital_calculator", "iss_position"],
    "missing_information": []
  },
  "trace": [
    { "type": "plan", "model": "…", "duration_ms": 12943, "tokens_in": 449, "tokens_out": 1025, "plan": { … }, "at": "…" },
    { "type": "tool_round", "iteration": 1, "duration_ms": 4102, "calls_requested": 2, "at": "…" },
    { "type": "tool_call", "iteration": 1, "tool": "orbital_calculator", "raw_args": { … },
      "validated_args": { … }, "coercions": ["…"], "ok": true, "result": { … },
      "attempts": 1, "duration_ms": 36, "at": "…" },
    { "type": "guardrail", "name": "prompt_injection_scrubbed", "detail": "…", "at": "…" },
    { "type": "synthesis", "duration_ms": 38498, "ungrounded_values": [], "at": "…" }
  ],
  "meta": {
    "model": "gemini-3.5-flash", "prompt_version": "agent-v1",
    "iterations": 2, "tool_calls": 2, "tool_failures": 0, "duration_ms": 123919,
    "tokens_in": 5874, "tokens_out": 5226, "cost_usd": null,
    "guardrails_triggered": []
  }
}
```

Status mapping — **a refusal is a valid answer, not an error**:

| `status` | HTTP | Meaning |
|---|---|---|
| `answered` | 200 | Question resolved from tool results. |
| `insufficient_data` | 200 | A required input is missing or a tool failed. `final_answer` says what. |
| `refused` | 200 | Out of domain. Refused at the planning step, before any tool call. |
| `rejected` | 400 | Failed a pre-model guardrail (empty or oversized input). |
| `error` | 200 | The model could not be reached. The trace still shows whatever was collected. |

`cost_usd` is `null` unless `GEMINI_INPUT_USD_PER_MTOK` / `GEMINI_OUTPUT_USD_PER_MTOK`
are set. Token counts are always exact; dollars are only reported when a rate is
configured.

### GET /api/agent/tools

The tool contract as the model sees it — name, description, timeout, retry
budget, JSON-Schema parameters. Four tools:

| Tool | Backed by | Timeout | Retries |
|---|---|---|---|
| `orbital_calculator` | `science/orbital.py` via `/calculate/*` | 10 s | 2 |
| `iss_position` | Celestrak TLE + SGP4 via `/iss/*` | 25 s | 1 |
| `apod` | NASA APOD, 1-hour cache | 15 s | 0 (client retries internally) |
| `neo_lookup` | NASA NeoWs, 1-hour cache | 20 s | 0 (client retries internally) |

---

## Calculator (deterministic physics)

Thin Zod-validated proxies to the science service. Units: km, s, km/s.
`altitude_km` is height above Earth's surface; `semi_major_axis_km` is a radius
from Earth's centre. A `422` from the engine passes through unchanged with its
`detail`; an unreachable engine is `502`.

| Route | Body | Returns |
|---|---|---|
| `POST /api/calculate/period` | `{ altitude_km }` | `period_s`, `period_min`, `semi_major_axis_km`, `formula` |
| `POST /api/calculate/velocity` | `{ altitude_km }` | `velocity_kms`, `velocity_kmh`, `semi_major_axis_km`, `formula` |
| `POST /api/calculate/escape-velocity` | `{ altitude_km }` | `escape_velocity_kms`, `escape_velocity_kmh`, `semi_major_axis_km`, `formula` |
| `POST /api/calculate/vis-viva` | `{ altitude_km, semi_major_axis_km }` | `velocity_kms`, `velocity_kmh`, `radius_km`, `semi_major_axis_km`, `formula` |
| `POST /api/calculate/energy` | `{ semi_major_axis_km }` | `specific_energy_kms2`, `specific_energy_kmh2`, `semi_major_axis_km`, `formula` |
| `POST /api/calculate/hohmann` | `{ alt1_km, alt2_km }` | `delta_v1_kms`, `delta_v2_kms`, `dv_total_kms`, `transfer_time_s`, `transfer_time_min`, radii, three `formula_*` strings |

---

## Gemini feature endpoints

Pre-agent endpoints, still in use by the tutor, problem-set and paper tabs.
Model `gemini-3.5-flash`; JSON-shaped routes constrain output with a
`responseSchema`. LaTeX uses `$inline$` / `$$block$$`.

| Route | Body | Returns |
|---|---|---|
| `POST /api/chat` | `{ message, history?, degreeLevel?, explainSimply? }` | `{ text }` |
| `POST /api/problems` | `{ topic, difficulty?, count? }` | `[{ id, problem, hint, formulas, solution }]` |
| `POST /api/quiz` | `{ topic, difficulty? }` | `[{ question, options[4], correctAnswer, explanation }]` |
| `POST /api/mission` | `{ missionName }` | `{ name, objectives, orbit, challenges, discoveries, links }` |
| `POST /api/papers/summarize` | `{ paperText, title? }` | `{ abstract, equations, methodology, findings }` |
| `POST /api/papers/chat` | `{ paperText, title?, message, history? }` | `{ text }` |
| `POST /api/solve` | `{ wordProblem }` | `{ problemType, parameters, recommendedFormula, stepByStep, finalAnswer, similarProblem }` |
| `POST /api/image/generate` | `{ prompt, model?, size?, aspectRatio? }` | `{ imageUrl, info }` |
| `POST /api/image/edit` | `{ base64Image, prompt, mimeType? }` | `{ imageUrl, info }` |

> `POST /api/solve` is superseded by `POST /api/agent/solve`: it asks the model to
> do the physics, which is exactly what ADR-003 rejects. Kept while the Problem
> Sets tab still calls it; scheduled for removal.

`history` is `[{ role: "user" | "model", text }]`.

---

## Admin

### GET /api/admin/metrics

Latency percentiles, token usage, error rates and cache-hit rates, computed in
SQL from `agent_traces` and `agent_tool_calls`
([ADR-008](decisions/ADR-008-hardening-and-operations.md) §4).

**Access:** the caller's user id must appear in `ADMIN_USER_IDS`. If that variable
is unset the route is **disabled entirely**. Both an unauthorised caller and a
disabled route get `404` — not `403`, which would confirm the endpoint exists.

**Query:** `?hours=24` (1–720) · `?format=json|text`

`format=text` renders a terminal-readable report; `json` returns:

```json
{
  "window_hours": 24,
  "generated_at": "…",
  "requests": {
    "count": 42, "refused": 3, "errored": 1,
    "p50_ms": 13000, "p95_ms": 23600, "p99_ms": 23600, "max_ms": 23600,
    "tokens_in": 123456, "tokens_out": 45678, "cost_usd": null
  },
  "routes": [ { "route": "/api/agent/solve#plan", "calls": 42, "errors": 1,
                "error_rate": 0.0238, "p50_ms": 12943, "…": "…" } ],
  "tools":  [ { "tool": "orbital_calculator", "calls": 58, "failures": 2,
                "failure_rate": 0.0345, "mean_attempts": 1.07,
                "cache_hit_rate": null, "p50_ms": 36 } ],
  "cost_note": "cost_usd is null unless GEMINI_INPUT_USD_PER_MTOK …"
}
```

Notes on reading it: per-**request** latency is the **sum** of that request's
model calls (one agent request is three `agent_traces` rows sharing a
`request_id`), so it is not comparable to a per-route percentile.
`cache_hit_rate` is `null` — not `0` — for tools that have no cache, so the
physics engine does not look like a 0% hit rate. If the database is unreachable
the response carries a `degraded` field rather than failing: the moment you most
want metrics is when something is wrong.

---

## Health

| Route | Auth | Returns |
|---|---|---|
| `GET /` | no | `{ "service": "AstroAI API" }` |
| `GET /health` | no | `{ "status": "ok" }` |

---

## Science service (internal)

Not public. The API is the only client; `SCIENCE_URL` points at it. Validation is
Pydantic, so bad input is `422` with a `detail` string.

| Route | Body | Notes |
|---|---|---|
| `GET /health` | — | `{ status, service }` |
| `POST /calculate/*` | see above | Six deterministic formulas from `orbital.py` |
| `GET /iss/position` | — | Sub-satellite point now, from the current TLE. `503` when no TLE is available. |
| `POST /iss/passes` | `{ place? , lat_deg?, lon_deg?, elevation_m?, days?, min_elevation_deg?, max_passes? }` | Needs `place` **or** both coordinates. Unknown place is `422` naming the alternative. |
| `GET /iss/places` | — | The gazetteer, so a caller can say which names are accepted. |
