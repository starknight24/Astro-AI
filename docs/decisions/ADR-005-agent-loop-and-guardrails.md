# ADR-005: Agent Loop Design & Guardrail Choices

**Status:** Accepted · **Date:** 2026-09-30

## Context

Week 4 replaces `/api/solve` — a single Gemini call that was asked to do the
physics itself — with an agent that plans, calls tools, and explains. Three
constraints shape the design.

First, the project's thesis (ADR-003) is that **physics is deterministic and the
LLM only orchestrates**. The eval harness in Week 6 grades model answers against
`science/orbital.py`, so the agent must never be the source of a number.

Second, the agent must be **inspectable**. The portfolio claim is "I can explain
user request → plan → tool call → tool result → synthesis → final answer". A
black box that happens to return the right number fails the brief even when it
is correct.

Third, this is a **solo project with a metered API key and a shared DEMO_KEY**
for NASA. Every guardrail has to pay for itself in tokens, latency, or blast
radius — not in architecture diagrams.

## Decision

### 1. Three explicit phases, hand-written, no framework

```
problem ──▶ [1 PLAN]  one model call, no tools. Produces a written plan and an
            │          in_domain verdict. Refusals happen here.
            ▼
        [2 TOOL LOOP] Gemini function calling, ≤6 rounds, ≤10 calls.
            │          Zod-validated args, per-tool timeout, backoff on
            │          transient failures. Errors go back to the model as text.
            ▼
        [3 SYNTHESIZE] one model call constrained to the answer contract,
                       given only the tool results actually collected.
```

No LangChain, no LlamaIndex, no `ai` SDK agent helper. The loop is ~250 lines in
`api/src/agent/loop.ts` and its whole value is that every branch is visible and
every guardrail sits where I put it. A framework would have supplied the same
loop with its own opinions about retries, memory and error handling — precisely
the parts this project exists to demonstrate. The tradeoff is real: no
multi-agent handoff, no streaming tool calls, no community middleware. None of
those are needed for four tools.

**Why a separate planning call rather than letting the tool loop plan
implicitly.** It costs one extra model round-trip (~2–13 s measured). It buys:
a refusal that happens before any tool or NASA quota is spent; a written plan in
the trace that can be compared against what the agent actually did; and an
explicit `missing_information` list, which is what turns "what's the period at
400?" into a clarifying question instead of a guess. The cost is latency, which
Week 7 will measure and may reclaim.

**Why a separate synthesis call rather than using the tool loop's last message.**
The tool phase needs `tools`; the answer needs `responseSchema`. Gemini accepts
both, but mixing them means the model that is still allowed to call tools is
also being asked to format a final answer, and the two goals interfere. Splitting
them also enforces the contract: the synthesiser sees only the collected results,
so it *cannot* quietly recompute something.

### 2. Guardrails, and what each one is actually for

| Guardrail | Where | What it prevents |
|---|---|---|
| `MAX_TOOL_ITERATIONS = 6` | loop | Runaway loops. On hitting it the agent **synthesises from what it has** and says it was capped, rather than erroring — a partial cited answer beats a 500. |
| `MAX_TOOL_CALLS = 10` | loop | One round can request many calls, so the round cap alone is not a budget. |
| `AGENT_DEADLINE_MS = 90_000` | loop | Wall-clock bound across phases, checked between rounds. |
| Per-tool timeout (10–25 s) | `runTool` | A slow dependency stalling the request. **Raced** against the executor, not just signalled via `AbortController`, so an executor that ignores its signal still cannot hang the agent. |
| Zod schema per tool | `runTool` | Malformed/missing/out-of-range arguments reaching a dependency. Failures are returned to the model as text so it can correct itself — that feedback loop is the point of validating here. |
| Argument coercion | `coerceArgs` | Models emit `"400"` and `"400 km"`. Unambiguous repairs are applied and **recorded in the trace**; ambiguous values (`"a few hundred km"`) are deliberately left to fail loudly. |
| Exponential backoff + full jitter | `withRetry` | Transient dependency failures. Applied to tools **and to model calls** — see "What broke" below. Retries only transient errors; a 4xx is our bug and retrying it only spends money. |
| Refusal path | plan phase | Out-of-domain requests, before any tool call. |
| Injection scrubbing | problem text **and every tool result** | Instruction-like text reaching the model. |
| Numeric grounding check | post-synthesis | Silent invention. Every value in `quantities` is matched against the numbers the tools returned (accepting exact unit conversions); unmatched values are reported in `caveats` and in the trace. |
| Input size cap (4000 chars) | pre-model | Cost amplification through a huge prompt. |
| Tool-result truncation (6000 chars) | pre-model | A large NeoWs payload crowding out the problem. |

**Why the domain check is a model call and not a keyword list.** "Is this about
space physics?" needs judgement: *"why is the ISS in a 51.6° orbit"* is in
domain with no numbers in it, and *"calculate the orbital period of my mortgage"*
is out of domain while containing the exact words a keyword filter would trust.
The planning call already exists, so the verdict is free. The honest cost is that
the refusal boundary is now probabilistic — which is why refusals are recorded as
`out_of_domain_refusal` in the trace and are in the Week-6 eval set.

**Why injection defence is layered rather than "solved".** There is no regex
that makes prompt injection safe, and claiming otherwise would be the real
failure. So the design minimises blast radius first and filters second:

1. **Tools are unreachable from text.** A tool call only happens through the
   registry, behind a Zod schema. The worst a successful injection achieves is a
   *bad answer* — never an unintended side effect, a shell, or a DB write.
2. **Untrusted text is always framed as data**, inside `<untrusted-problem>` /
   `<untrusted-tool-results>` delimiters, with the system instruction stating
   that content inside them is never an instruction.
3. **Imperative patterns are redacted, not dropped**, so the model sees that
   something was removed and the trace records exactly what.
4. **Tool output is scrubbed too.** This is not hypothetical: the gazetteer
   echoes an unknown place name back in its error message, so user text can
   round-trip through a tool result. NASA APOD explanations are third-party text
   on the same footing.
5. **No secret is ever in the model's context** — API keys live in
   `process.env`, and the NASA client keeps them out of error messages too.

### 3. Tool choices

**`orbital_calculator` is a pass-through, not a calculation.** One tool with an
`operation` enum rather than six tools, so the model picks a formula rather than
a URL. Its results are wrapped with a `source` string naming
`science/orbital.py` — without it the synthesiser improvised a "source" from the
arguments (observed, then fixed).

**`iss_position` uses Celestrak TLEs propagated with SGP4 in the science
service — not Open Notify, not N2YO.** The plan allowed either. Measured, at
2026-09-30T22:54Z:

| Source | Sub-satellite point | Ground error vs. ours |
|---|---|---|
| Our SGP4 + GMST frame chain | −24.6645°, −15.5856° | — |
| api.wheretheiss.at (independent SGP4) | −24.6649°, −15.5864° | **0.1 km** |
| api.open-notify.org/iss-now | −30.37°, +114.34° | **12,049 km** (best-fit offset: **+29 min stale**) |

Open Notify was serving half-hour-old positions, which for a pass prediction is
not a small error — it is a different continent. N2YO requires an API key, adds a
third-party rate limit to a hot path, and would still be someone else's SGP4.
Doing the propagation ourselves costs ~200 lines of frame conversions and gives
an offline, deterministic, testable tool.

This is the tool-vs-craft boundary ADR-003 promised to record here: the six
textbook formulas are hand-written because writing them *is* the exercise and
each returned intermediate is a design choice; **SGP4 is not hand-written**,
because it is a specified model whose only correct implementation is the
reference one. Polar motion (TEME→PEF→ITRF) is skipped: metres of ground-track
error against pass windows measured in minutes.

**Place names come from a curated 84-city gazetteer, not a geocoder.** A live
geocoder adds a fourth external dependency, a key, and a rate limit to satisfy
"over Toronto". The table is offline, deterministic (so Week-6 evals are
reproducible), and **fails loudly** — an unknown place returns an error telling
the caller to pass lat/lon, which the agent surfaces as a clarifying question
instead of guessing a location.

### 4. Caching: Postgres, 1 hour, two layers

NASA responses are cached for an hour in an in-process `Map` backed by a
`public.api_cache` table (migration 002). No Redis: a second datastore for an
hour-stale cache of public data is more operational surface than the problem
deserves, and ADR-002's "one database" reasoning applies unchanged. The Postgres
layer is **best-effort** — if `api_cache` is missing or unreachable the cache
degrades to memory-only and the request still succeeds, matching `upsertUser`'s
posture.

The cache is not a nicety: `NASA_API_KEY` defaults to NASA's shared `DEMO_KEY`
(≈30 requests/hour/IP), and api.nasa.gov is measurably unreliable — three
consecutive probes of `/planetary/apod` during this week returned timeout, 200,
and 500.

### 5. Output contract

Every answer carries `steps`, `formulas`, `citations`, `quantities` (value +
unit) and `final_answer`, enforced by a Gemini `responseSchema` rather than
requested in prose. `status` is one of `answered` / `insufficient_data` /
`refused`, so "I could not answer" is a first-class outcome instead of an
apologetic paragraph. The full `trace` ships **in the API response**, not just to
a log, because an inspectable agent whose trace requires database access is not
inspectable in practice.

### 6. Tracing

`agent_traces` keeps its migration-001 contract: one row per LLM call, rows
sharing a `request_id`. Tool calls go to a new `agent_tool_calls` table rather
than being forced into columns that describe model invocations. `cost_usd` is
**null unless token prices are configured** in the environment — a hard-coded
price table goes stale and silently produces fabricated cost figures, so tokens
are recorded exactly and dollars only when someone supplies a rate.

## Alternatives Considered

**Let the model compute and call tools only for data (the status quo of
`/api/solve`).** Cheapest, and already shipping. Rejected for the reason ADR-003
gives: a system cannot be graded by itself, and LLM arithmetic is not acceptable
for engineering students.

**A framework agent (LangChain / LlamaIndex / Vercel `ai`).** Less code, batteries
included, community-tested retry and memory. Genuinely tempting and not a
strawman — it would have shipped in a day. Rejected because the loop *is* the
deliverable: guardrail placement, the plan/synthesis split, and the trace shape
are the engineering being demonstrated, and inheriting them removes the thing
worth explaining.

**One combined tools + responseSchema call.** Saves a model round-trip. Rejected:
a model that may still call tools should not also be composing the final answer,
and the split is what guarantees the synthesiser cannot recompute a number.

**N2YO for ISS passes.** Purpose-built, includes visual-magnitude data we do not
compute. Rejected on the key/rate-limit dependency and because it moves the
project's most interesting physics off-site.

**Redis for the response cache.** The right answer at scale. Rejected at this
scale — see §4.

**Blocking on the numeric grounding check** (refusing to return an answer with
unmatched values). Rejected as too brittle: legitimate false positives exist
(a student-supplied input echoed back, a rounded intermediate), and turning them
into failures would train me to ignore the signal. It reports instead, and
Week 6 will measure how often it fires.

## Consequences

The agent is correct, cited and inspectable. The Week-4 exit request —
*"Calculate the orbital period of a satellite at 400 km and tell me when the ISS
next passes over Toronto"* — returns 92.56 min from the engine and a
00:05:41 UTC ISS rise over Toronto from SGP4, with two tool citations, five
united quantities, and a caveat naming the TLE epoch.

**The cost I weight most heavily is latency.** The exit-criterion request took
**124 s** end to end (plan 13 s, tools ~0.05 s, synthesis 38 s, the remainder in
tool-phase model calls and their retries during a Gemini demand spike). Three
model calls per request is the floor of this design, and the physics is
essentially free — **the LLM is the entire latency budget**. This is now the
first thing Week 7 must measure, and it is why every model call is traced with
its own duration.

**What broke, and what changed because of it.** During the first live run of the
exit criterion, Gemini returned `503 UNAVAILABLE` ("high demand") in the tool
phase. The agent degraded exactly as designed — `insufficient_data`, no
invented numbers — but the run was wasted after already paying for planning.
Tool failures had backoff; *model* failures did not. Model calls are now wrapped
in the same `withRetry` (2 retries, transient-only), and the immediate re-run
succeeded. This is the concrete argument for retrying the orchestration layer
and not just its dependencies.

Two secondary consequences accepted with eyes open: the refusal boundary is
model-judged and therefore probabilistic (mitigated by tracing it and putting it
in the eval set); and the injection filter is a pattern list that will miss novel
phrasings — which is why the design leans on blast-radius reduction first and
treats the filter as defence in depth, not a solution.

**Revisit trigger:** if Week 7 shows the planning call dominating p95 without
catching refusals that the tool phase would have caught anyway, collapse plan and
tool phases into one call and accept the loss of the pre-tool refusal. If token
cost per request exceeds what a portfolio demo can absorb, drop the synthesis
call and constrain the tool phase's final message instead.

## References

- ADR-001 (service topology), ADR-003 (deterministic physics engine, which
  deferred the tool-vs-craft boundary to this ADR)
- `docs/failure-modes.md` — the adversarial suite this design was tested against
- `api/src/agent/{loop,tools,guardrails,contract}.ts`, `science/{iss,places}.py`
- Vallado, *Fundamentals of Astrodynamics and Applications*, ch. 3–4 (frames)
