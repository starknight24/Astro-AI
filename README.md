# 🚀 AstroAI

AI-powered learning platform for space-engineering and astronomy students — a conversational tutor, practice-problem generator, orbital calculator, NASA data explorer, research-paper workspace, quiz mode, and AI space artist, fronted by a scroll-driven Three.js landing page.

Built with **React 19 + Vite 6 + Tailwind CSS 4** on the frontend and **Express + Google Gemini** on the backend.

## Quickstart

```bash
# Requirements: Node.js >= 20
npm install
cp .env.example .env         # add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Without a `GEMINI_API_KEY` the server boots in fallback mode; AI endpoints will fail but the UI, landing page, and calculators still work.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (Express + Vite middleware, HMR) on port 3000 |
| `npm run build` | Builds the SPA (`vite build`) and bundles the server (`esbuild` → `dist/server.cjs`) |
| `npm start` | Runs the production bundle — **must** be run with `NODE_ENV=production` |
| `npm run lint` | Type-checks the project (`tsc --noEmit`) |
| `npm run clean` | Removes build artifacts |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (for AI features) | Server-side Google Gemini API key. Never exposed to the client. |
| `APP_URL` | No | Public URL of the deployment (self-referential links). |
| `NODE_ENV` | In production | `production` switches Express from Vite middleware to serving `dist/`. |

## Project layout

```
server.ts              Express server + all /api/* Gemini endpoints
index.html             SPA entry
src/
  main.tsx             React root (StrictMode)
  App.tsx              Landing ⇄ Dashboard view toggle
  components/
    LandingPage.tsx    Scroll-driven Three.js WebGL cinematic
    Dashboard.tsx      Authenticated-feel workspace shell (tabs, telemetry)
    ConceptExplainer.tsx / OrbitalCalculator.tsx / ProblemGenerator.tsx
    NasaExplorer.tsx / PaperRag.tsx / QuizMode.tsx / SpaceArtist.tsx
  types.ts             Shared TypeScript types
public/assets/         Landing-page textures (milkyway, galaxies, saturn)
docs/                  Architecture, API, deployment, security, contributing, roadmap
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, data flow, key decisions
- [API reference](docs/API.md) — all `/api/*` endpoints
- [Deployment](docs/DEPLOYMENT.md) — chronological path to a public launch
- [Security](docs/SECURITY.md) — current posture and hardening checklist
- [Contributing](docs/CONTRIBUTING.md) — dev setup, conventions, verification
- [Roadmap](docs/ROADMAP.md) — product plan (from the Cosmos PRD) vs. current state

## Status

Pre-launch. The app runs end-to-end locally; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the ordered list of what remains before it is publicly usable.
