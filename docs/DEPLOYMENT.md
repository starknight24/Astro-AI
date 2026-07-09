# Deployment — Path to Public Launch

This is the **chronological** checklist to take AstroAI from its current state (runs locally, pre-launch) to publicly usable. Items are ordered by dependency: each phase assumes the previous one is done. Derived from the current codebase plus the Cosmos product plan (see [ROADMAP.md](ROADMAP.md)).

---

## Phase 0 — Repository hygiene *(hours)*

1. **Merge the landing-page PR** ([#1](https://github.com/starknight24/Astro-AI/pull/1)) into `main`.
2. **Delete the stray duplicate** `src/ConceptExplainer.tsx` (identical, untracked copy of `src/components/ConceptExplainer.tsx`).
3. **Rename the package** from `react-example` to `astro-ai` in `package.json`; set `"version": "0.1.0"`.
4. **Add an `engines` field** (`"node": ">=20"`) — dev tooling (`tsx` ESM loader) breaks on Node 18.
5. **Add a LICENSE** file (decide: proprietary or OSS).
6. Commit the docs in this folder.

## Phase 1 — Make the server production-runnable *(half a day)*

7. **Respect the platform port**: change `const PORT = 3000` in `server.ts` to `const PORT = Number(process.env.PORT) || 3000`. Every PaaS (Render, Railway, Cloud Run, Fly) injects `PORT`.
8. **Fail fast on missing key in production**: the server currently boots with `"MOCK_KEY"` and returns opaque 500s. In production, log-and-exit (or expose a clear 503) when `GEMINI_API_KEY` is unset.
9. **Add a healthcheck**: `GET /healthz → 200 {"ok":true}` — required by most hosts' liveness probes.
10. **Verify the production path locally**:
    ```bash
    npm run build
    NODE_ENV=production node dist/server.cjs
    ```
    Confirm the landing page, dashboard, and one AI endpoint work. Note: `npm start` does **not** set `NODE_ENV` — the host must, or the start script should be changed to `NODE_ENV=production node dist/server.cjs`.
11. **Sanitize 500 responses**: stop returning raw `error.message` (can leak key/quota details); log server-side, return a generic message + request id.

## Phase 2 — Security & cost hardening *(1–2 days — blocking for public exposure)*

> Every endpoint is currently an unauthenticated proxy to a metered Gemini key. Deploying publicly without this phase is an open invitation to drain the API budget. Details in [SECURITY.md](SECURITY.md).

12. **Rate limiting** (`express-rate-limit`): global + stricter buckets for `/api/image/*` (most expensive calls).
13. **Input validation** (`zod`): type/length caps on every body field (`message`, `paperText`, `prompt`, `count` ≤ 5, etc.); reject oversized/malformed bodies with 400.
14. **Per-route body limits**: keep `20mb` only for `/api/image/edit`; drop the global default to ~100kb.
15. **HTTP hardening**: `helmet`, explicit CORS (same-origin only), `app.set("trust proxy", 1)` behind the host's proxy.
16. **Secrets**: `GEMINI_API_KEY` into the host's secret store; confirm `.env*` never ships (already gitignored); rotate the key if it was ever pasted anywhere.
17. **Set a Gemini spending cap / budget alert** in Google AI Studio / Cloud console.

## Phase 3 — Hosting & CI/CD *(1 day)*

18. **Pick a Node host** — the app needs a server (secret key), so static-only hosting is out. Simplest fits: Render / Railway / Fly.io / Cloud Run.
    - Build: `npm ci && npm run build`  •  Start: `NODE_ENV=production node dist/server.cjs`  •  Health: `/healthz`
    - (Optional) Add a `Dockerfile` for reproducibility if using Cloud Run/Fly.
19. **CI on GitHub Actions**: on PR → `npm ci && npm run lint && npm run build`; on merge to `main` → deploy. Protect `main` behind the check.
20. **Custom domain + TLS** (hosts provision certificates automatically); set `APP_URL` to the public URL.
21. **Post-deploy smoke test**: landing page renders (WebGL), Launch → dashboard, one call to each of the 8 `/api/*` endpoints.

## Phase 4 — Minimum public-product bar *(2–4 days)*

22. **Persistence**: notes/quiz scores/telemetry are in-memory and vanish on refresh. Minimum viable: localStorage. Proper: Postgres (Supabase) per the product plan.
23. **Monitoring**: Sentry (frontend + backend) + an uptime ping on `/healthz`.
24. **React error boundary** around the dashboard tools + graceful AI-failure states in each tab (some tabs already handle errors; verify all 7).
25. **SEO & sharing**: `index.html` has only a title — add meta description, OpenGraph/Twitter tags, favicon, `robots.txt`, `sitemap.xml`.
26. **Legal pages**: privacy policy + terms (AI-generated content disclaimer, data handling); footer links.
27. **Analytics** (privacy-friendly, e.g. Plausible) to measure the PRD's KPIs (session length, feature usage).
28. **Cross-browser/device QA**: WebGL landing on Safari/Firefox/mobile; verify the no-WebGL fallback; Lighthouse pass (the ~11 MB landing textures likely need compression/lazy-loading to hit acceptable scores on mobile).

## Phase 5 — Launch *(per the Cosmos plan §Sprint 8)*

29. **Private beta** (~20 students), feedback form, fix top issues.
30. **Load sanity check** (e.g. 100 concurrent users hitting non-AI + AI routes; confirm rate limits behave).
31. **Launch assets**: ProductHunt page, social posts, demo GIF.
32. **Public launch** — monitor Sentry, server load, and Gemini spend in real time on day one.

## Phase 6 — Post-launch roadmap (from the Cosmos PRD)

Not required to be "publicly usable", but the PRD's monetization/scale path — in its intended order: auth (Firebase) → database (Supabase Postgres) → freemium gates + Stripe → real PDF RAG pipeline (upload → chunk → embed → vector search) → live NASA APIs (APOD, NeoWs, Mars rovers, ISS) → premium 3D orbital simulator → referral/onboarding/email. Details and gap analysis in [ROADMAP.md](ROADMAP.md).

---

## Environment matrix

| Variable | Dev | Production |
|---|---|---|
| `GEMINI_API_KEY` | `.env` file | Host secret store (**required — fail fast**) |
| `NODE_ENV` | unset | `production` (**required** — switches to static serving) |
| `PORT` | 3000 default | Injected by host (after Phase 1 fix) |
| `APP_URL` | `http://localhost:3000` | Public https URL |
| `DISABLE_HMR` | AI Studio only | n/a |
