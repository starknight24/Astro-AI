# Roadmap

Future work lives in **[design.md §8](design.md#8--future-work)**, in the order it
would actually be done. Keeping a second list here guaranteed the two would drift
— and they did: this file previously described the RAG pipeline, authentication
and live NASA integration as unbuilt, months after they shipped.

## Status

Weeks 1–8 of an 8-week build, complete and documented.

| Week | Delivered |
|---|---|
| 1–2 | monorepo split, CI, Docker, Supabase auth, 14-table schema with deny-all RLS |
| 3 | deterministic physics engine (6 formulas, 62 tests), calculator wired end to end |
| 4 | the agent — plan → tools → synthesize, 4 tools, guardrails, 18 adversarial cases |
| 5 | RAG — PDF → section-aware chunks → pgvector → answers with code-verified page citations |
| 6 | evaluation harness, engine-generated goldens, versioned LLM judge, one controlled experiment |
| 7 | rate limiting, idempotency, metrics, k6 load testing, OWASP review, Sentry |
| 8 | design doc, ADR sweep (004 + 008), README, demo, walkthrough, resume bullets |

Measured results: [eval-history.md](eval-history.md) · [load-test.md](load-test.md)

## Where the original product plan was not followed

The source plan ("Cosmos", March 2026) specified a stack that was changed
deliberately. Each divergence has an ADR with the reasoning:

| Plan said | Built instead | Why |
|---|---|---|
| OpenAI GPT-4o + LangChain | Google Gemini, agent loop written by hand | [ADR-005](decisions/ADR-005-agent-loop-and-guardrails.md) — the loop is the deliverable |
| Pinecone | pgvector on the existing Postgres | [ADR-002](decisions/ADR-002-pgvector-vs-pinecone.md) — one database, metadata filtering is a `WHERE` clause |
| Firebase Auth | Supabase Auth, JWT verified at the API | [ADR-004](decisions/ADR-004-authentication.md) — one identity, no second vendor |
| Physics in the LLM / client | a deterministic Python engine | [ADR-003](decisions/ADR-003-deterministic-physics-engine.md) — a system cannot be graded by itself |
| Open Notify or N2YO for ISS data | Celestrak TLEs propagated with SGP4 in-house | Open Notify measured 29 minutes (~13,000 km) stale |
| Grafana Cloud | one metrics endpoint over our own trace tables | [ADR-008](decisions/ADR-008-hardening-and-operations.md) §4 |

## Explicitly out of scope

Stripe and freemium gates, the 3D orbital simulator, collaborative study rooms,
a professor portal, React Native apps, LMS integration, WebXR. The scope stayed
narrow so the engineering thesis could be demonstrated rather than gestured at.

Quiz Mode and the AI Space Artist exist in the codebase from the original
scaffold and are outside the v0.1 feature set; they are candidates for removal.
