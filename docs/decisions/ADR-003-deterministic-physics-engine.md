# ADR-003: A Deterministic Physics Engine, in Python

**Status:** Accepted · **Date:** 2026-07-23

## Context

AstroAI's core promise is *correct* orbital-mechanics answers for engineering students. The system already has an LLM (Gemini) capable of producing plausible numeric answers, so the default path — the one the original scaffold took — was to let the model compute. But the product's differentiation strategy (see project plan §0) depends on evaluation against ground truth, and the upcoming agent (Week 4) and eval harness (Week 6) both need a source of physics answers that is exact, fast, and free. The question was whether to build a dedicated deterministic computation engine, and if so, in what language and shape.

## Decision

Build `science/orbital.py`: a pure Python module of hand-written orbital-mechanics functions (orbital period, orbital and escape velocity, vis-viva, specific orbital energy, Hohmann transfer), each returning computed values, useful intermediates, and the governing formula as a string. The module has no framework dependencies; thin FastAPI routes expose it over HTTP, and the Express API proxies to those routes behind auth and Zod validation.

Four reasons, in order of weight:

1. **Ground truth for evaluation — the project's thesis.** The eval harness grades the LLM's physics answers against this engine. A probabilistic system evaluated by a deterministic one is the architecture the entire portfolio argument rests on; without the engine there is no eval story.
2. **Correctness for users.** LLM arithmetic is unreliable, and this product's users are engineering students for whom a 4%-wrong orbital period is not a rounding curiosity. Deterministic math is the only acceptable source for numeric answers.
3. **Cost and latency.** Pure computation should not spend tokens or wait on a model round-trip. The engine answers in microseconds for free.
4. **Trust and citability.** Every response carries the formula it used, so answers cite `T = 2π·√(a³/μ)` rather than asserting a number — provenance the agent will surface to users.

**Why Python, given v1 needed only the standard library:** the Week-4 roadmap requires ISS pass prediction, whose proper implementation (SGP4 propagation via `sgp4`/`skyfield`) lives in the Python ecosystem; the eval harness will be Python and imports `orbital.py` directly with zero glue; ADR-001 had already established the Python science service, so the engine lives where the project's scientific computing belongs; and NumPy/Astropy provide headroom for heavier numerical work. I note honestly that v1 uses only `math` — the ecosystem argument is about the near future, not the present file.

**Why pure functions behind thin routes:** the module is testable without a server, importable by the eval harness without HTTP, and framework churn cannot touch the physics.

## Alternatives Considered

**Let the LLM compute (status quo of the scaffold).** Zero build cost; already partially working. Rejected because it fails all four reasons above — most fatally, a system cannot be graded by itself.

**LLM computes, engine verifies after the fact.** Keeps the model in the loop for "flexibility." Rejected as the worst of both: pays token cost and latency, then needs the engine anyway; and users would still see model-generated numbers before verification.

**TypeScript engine inside the Express API.** Avoids the HTTP hop entirely. Rejected because it forfeits the Python scientific ecosystem the Week-4 roadmap needs, and separates the engine from the Python eval harness that must import it.

**Depend on a library (Astropy/poliastro) instead of hand-writing v1.** Less code, vetted implementations. Deliberately declined *for the core six formulas*: hand-writing them is cheap (~60 lines), makes every returned intermediate and formula string a first-class design choice, and the exercise is part of the point. The decision explicitly reverses for genuinely hard computation — orbital propagation for pass prediction will use `sgp4`/`skyfield` rather than hand-rolled math (tool-vs-craft boundary, to be recorded in ADR-005).

## Consequences

The eval harness gains an exact grader; users get correct numbers with cited formulas; calculations cost nothing per call; the physics is unit-tested against textbook/NASA reference values (20+ tolerance-based cases in CI).

The cost I weight most heavily: **every calculation now pays the api→science HTTP hop.** This is the concrete instance of the latency cost accepted abstractly in ADR-001, and it is now on the measurement docket — Week 7 load tests will quantify it, and ADR-001's revisit trigger (fold into one service if the hop dominates p95) applies here first.

Two secondary consequences accepted with eyes open: validation now exists at two boundaries (Zod at the public door, Pydantic at the internal one) — duplication by design, since each service defends its own boundary; and the engine is load-bearing for evaluation, meaning a physics bug would silently corrupt eval grades as well as user answers — which is precisely why the test suite leans on independent reference values (NASA/textbook numbers) and cross-checking property tests rather than testing the engine against itself.
