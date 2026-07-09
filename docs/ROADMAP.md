# Roadmap — Cosmos PRD vs. Current State

Source: the **AstroAI Product Requirements & Implementation Plan** ("Cosmos 🚀", dated March 8, 2026, original launch target May 2, 2026). The plan's calendar has passed; treat its 4 phases as a **sequencing guide**, not dates. This doc maps that plan onto what actually exists in the repo.

## Where the implementation diverged from the PRD (deliberate or drift)

| PRD says | Repo has | Verdict |
|---|---|---|
| OpenAI GPT-4o + LangChain | Google Gemini (`gemini-3.5-flash`, image models) via `@google/genai` | Keep Gemini — working, cheaper, one SDK, structured output built in. Update the PRD, not the code. |
| Node API + separate Python FastAPI microservice (physics, PDF) | Single Express server; physics math lives client-side in `OrbitalCalculator.tsx` | Single service is fine through launch; split only when RAG/compute load demands it. |
| Pinecone vector DB + real RAG | Paste-text summarize/chat grounded on a truncated snippet | Real gap — premium feature (below). |
| PostgreSQL (Supabase) persistence | None; all state in React memory | Biggest product gap. |
| Firebase Auth + JWT middleware | No auth | Blocks freemium/quotas. |
| Stripe freemium ($5 Student / $12 Pro) | No payments, no gates | Post-launch monetization. |
| SSE streaming chat | Request/response JSON | Nice-to-have; improves perceived latency. |
| Live NASA APIs (APOD, NeoWs, Mars rovers, ISS) | Curated static NASA data + hot-linked images | Upgrade path defined (below). |
| React Three Fiber + Recharts | Imperative Three.js (landing); no charts yet | Landing stays imperative by design; R3F/Recharts when the 3D simulator is built. |
| Sentry, GitHub Actions CI/CD, Vercel+Render | None yet | Covered in [DEPLOYMENT.md](DEPLOYMENT.md) Phases 3–4. |

## Feature matrix — PRD tier vs. status

**Free tier (PRD §2.1)**

| Feature | Status |
|---|---|
| Concept Explainer (LaTeX, level toggle) | ✅ Built (`ConceptExplainer.tsx` + `/api/chat`) |
| Practice Problem Generator | ✅ Built (`ProblemGenerator.tsx` + `/api/problems`, `/api/solve`) |
| Orbital Calculator | ✅ Built, client-side math (`OrbitalCalculator.tsx`) |
| Space Mission Explainer | ✅ Endpoint exists (`/api/mission`); surfaced inside NASA Explorer |
| NASA Data Explorer | 🟡 Static curated data — needs live APOD/NeoWs/Mars/ISS APIs |
| Student Dashboard (stats, bookmarks, history) | 🟡 UI built; no persistence, resets on refresh |

**Premium tier (PRD §2.2)**

| Feature | Status |
|---|---|
| Research Paper RAG (PDF upload → cited answers) | 🟡 Paste-text Q&A only; no PDF ingestion, chunking, embeddings, or citations |
| Paper Summarizer | ✅ Built (`/api/papers/summarize`) — snippet-truncated |
| Quiz Mode (graded, score history) | 🟡 Built + auto-graded; history not persisted |
| Space Problem Solver | ✅ Built (`/api/solve`) — LLM-solved, not Python-computed |
| 3D Orbital Simulation (orbits, Hohmann, solar system, constellations, Lagrange) | ❌ Not started (the Three.js landing page is marketing, not the simulator) |
| Solar System Viewer | ❌ Not started |
| *(Bonus, not in PRD)* AI Space Artist (image gen/edit) | ✅ Built (`SpaceArtist.tsx` + image endpoints) |

## Re-sequenced plan from today

The PRD's Phase 4 ("Polish, Premium & Launch") partially maps to [DEPLOYMENT.md](DEPLOYMENT.md) Phases 0–5, which come first. After public launch:

1. **Persistence + Auth** *(PRD Sprint 2)* — Supabase Postgres (users, sessions, messages, notes, quiz_results) + Firebase Auth + JWT middleware. Unlocks: durable dashboard, quiz history, per-user quotas.
2. **Freemium + Stripe** *(PRD Sprint 7)* — usage-tracking middleware, free-tier limits (PRD: 20 AI messages/day), pricing page, webhook activation, billing portal.
3. **Real RAG pipeline** *(PRD Sprint 3)* — PDF upload → text extraction → chunking → embeddings → vector store (Pinecone or pgvector on the existing Postgres) → top-k retrieval with page/section citations. Replaces the snippet-truncation approach.
4. **Live NASA integration** *(PRD Sprints 3–4)* — APOD, NeoWs asteroids, Mars Rover Photos, ISS position; 1-hour response cache (PRD risk register) and "Ask AI about this" hooks.
5. **3D Orbital Simulator** *(PRD Sprints 5–6, premium)* — R3F scene: Earth + orbit renderer, animated satellites, Hohmann transfer animation, solar system view, constellations (HYG), Lagrange points; mobile low-poly fallback.
6. **Streaming + polish** — SSE chat streaming, Recharts comparisons, formula reference library, onboarding tour, referral program *(PRD Sprint 7)*.

## PRD launch metrics to instrument (once analytics exist)

- 500+ signups week 1; 50+ premium subscribers month 1; >8% premium conversion in 30 days
- Session length > 12 min; D7 retention > 30%; >60% of users try the orbital calculator
- <2% AI-response error rate; P95 <500 ms non-RAG, <3 s RAG

## Deferred (PRD §8, v1.1+ backlog)

Collaborative study rooms • professor portal • textbook-level RAG • in-browser Python sandbox • React Native apps • LMS (Canvas/Blackboard) integration • WebXR AR sky overlay • multiplayer quiz battles.
