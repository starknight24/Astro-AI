# ADR-001: Repository and Service Topology

**Status:** Accepted · **Date:** 2026-07-14

## Context

AstroAI began as a single flat package: a Vite/React frontend and an Express server sharing one `package.json` in one directory. This worked for a first prototype but broke down quickly: frontend and backend dependencies were tangled in one manifest, the services could not be deployed or scaled independently, and there was no place for Python — which the project needs, because the physics engine (NumPy/Astropy) and PDF processing (pymupdf) live in ecosystems that have no serious Node equivalent. I am a solo developer with an 8-week deadline and roughly 10 hours per week, deploying the frontend to Vercel and long-running services to Render. The computation-heavy work (physics, PDF parsing, later embeddings) has a different load profile from the request/response API in front of it.

## Decision

One Git monorepo containing three independently deployable packages: `web/` (Vite + React + TypeScript), `api/` (Node + Express + TypeScript — the only public entry point), and `science/` (Python + FastAPI — internal service for physics and document processing).

The API stays in TypeScript rather than moving everything to Python for two reasons: the API shares types end-to-end with the React frontend, which gives compile-time safety across the network boundary, and Node's streaming/SSE ecosystem is a natural fit for the chat experience at the core of the product.

## Alternatives Considered

**Flat single package (the status quo).** Lowest setup cost, and fine for a demo — but rejected with direct evidence: tangled dependencies, no independent deployment, and no home for Python.

**All-Python monolith (FastAPI serves everything).** The strongest alternative: one runtime, no HTTP hop, simplest ops. It loses on the two points above — no shared types with the frontend, and a weaker fit for the streaming chat path. I consider this genuinely close, not a strawman.

**Polyrepo (three separate Git repositories).** Cleaner access boundaries at company scale; for a solo developer it triples repository administration, splits documentation and CI, and turns cross-service changes into multi-PR work. Overkill here.

**Finer-grained microservices (separate auth/RAG/etc. services).** Mentioned only to bound the decision: two services is the maximum complexity this project's scale justifies.

## Consequences

Each domain gets the right tool (TypeScript for the typed API surface, Python for scientific computing), and the science service can be scaled or redeployed independently of the API. The seam also makes the system easy to explain: one public API, one internal computation service.

The costs are real and accepted. The one I weight most heavily is operational: **two deploy targets plus a CORS seam that must be configured and kept in sync** — already experienced in practice when a mismatched `WEB_ORIGIN` (exact-origin string matching) silently blocked all browser requests. Additionally, every physics call pays an HTTP hop, and two runtimes mean two toolchains to maintain (two separate Node-version incidents during setup underline that this is not hypothetical).

**Revisit trigger:** if Week 7 load testing shows science-call latency dominating p95, I will reconsider folding the API into a single FastAPI service and accept the loss of shared types.
