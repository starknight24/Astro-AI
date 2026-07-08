# Architecture

## Overview

AstroAI is a single-repo, two-tier application:

```
Browser (React SPA)
  │  fetch("/api/…")  — same-origin JSON
  ▼
Express server (server.ts)
  │  @google/genai SDK — server-side only
  ▼
Google Gemini API
```

There is intentionally **one deployable service**: Express serves both the API and the SPA (Vite middleware in dev, static `dist/` in production). This keeps hosting simple (one process, one port) at the cost of not scaling the AI proxy independently — acceptable at current scale; see [ROADMAP.md](ROADMAP.md) for the planned service split.

## Frontend

- **React 19 + TypeScript + Vite 6 + Tailwind CSS 4**. `tsconfig` is intentionally non-strict; `three@0.128.0` types resolve to `any` (no `@types/three`).
- **`src/App.tsx`** holds a single `"landing" | "app"` view state.
  - **`LandingPage.tsx`** — a scroll-driven WebGL cinematic. One `useEffect` owns the whole Three.js scene; scroll progress `p ∈ [0,1]` over a 660vh track drives a `CatmullRomCurve3` camera path, while DOM overlay stages/HUD are mutated directly via `data-*` selectors inside a single `requestAnimationFrame` loop. If WebGL init throws, `fail()` hides the canvas and runs a DOM-only loop over the dark background.
    - ⚠️ StrictMode note: cleanup disposes the renderer but must **not** call `forceContextLoss()` — the effect remounts on the same `<canvas>` and a force-lost context cannot be re-acquired.
  - **`Dashboard.tsx`** — workspace shell: header, telemetry sidebar, and seven feature tabs (Space Tutor, Orbit Calculator, Problem Sets, NASA Explorer, RAG Workspace, Quiz Mode, Space Artist).
- **State is in-memory only.** Notes, activity history, quiz scores, and generated images all live in React state and are lost on refresh. There is no client persistence (no localStorage) and no backend persistence. This is the single biggest product gap before public launch.
- **`NasaExplorer.tsx`** currently renders a curated static dataset with hot-linked NASA images — it does not yet call live NASA APIs.
- **`PaperRag.tsx`** is paste-text based; there is no real PDF ingestion or vector retrieval (see roadmap).

## Backend (`server.ts`)

A single Express app exposing eight Gemini-backed endpoints (see [API.md](API.md)):

| Concern | Implementation |
|---|---|
| AI client | `@google/genai`, lazily initialized singleton; warns and uses a mock key if `GEMINI_API_KEY` is missing |
| Text endpoints | `gemini-3.5-flash`, most with `responseSchema`-constrained JSON output |
| Image generation | `gemini-3-pro-image-preview` (1K/2K/4K sizes) |
| Image editing | `gemini-3.1-flash-image-preview` |
| Body parsing | `express.json({ limit: "20mb" })` (image payloads) |
| Dev serving | Vite in middleware mode (`appType: "spa"`) |
| Prod serving | `express.static(dist)` + SPA catch-all `GET *` → `index.html`, gated on `NODE_ENV === "production"` |

Known constraints (tracked in [DEPLOYMENT.md](DEPLOYMENT.md)):

- `PORT` is hardcoded to `3000` — PaaS hosts inject `process.env.PORT`.
- No rate limiting, input validation, or auth: every endpoint is an open proxy to a metered API.
- Raw `error.message` is returned to clients on 500s.
- No healthcheck endpoint.

## Build & runtime modes

`npm run build` produces a self-contained `dist/`:

1. `vite build` → `dist/index.html` + hashed assets + `public/` copies.
2. `esbuild server.ts` → `dist/server.cjs` (CJS, `--packages=external`, so `node_modules` must be present at runtime).

`npm start` runs `node dist/server.cjs`. **`NODE_ENV=production` must be set** — otherwise the bundled server tries to boot Vite middleware.

## Key design decisions

1. **API keys never reach the browser.** All Gemini calls go through Express; the client only sees `/api/*`.
2. **Structured output via `responseSchema`.** Endpoints that feed UI components (problems, quiz, mission, summarize, solve) constrain Gemini to JSON schemas rather than parsing free text.
3. **Imperative Three.js over react-three-fiber.** The landing page is a faithful port of a vanilla-JS design bundle; wrapping it in R3F would have added indirection without benefit for a fire-and-forget cinematic.
4. **Single rAF loop.** All landing-page motion (camera, planets, HUD text, stage opacity) is driven from one loop — no CSS keyframe visibility gating, per the original design spec.
