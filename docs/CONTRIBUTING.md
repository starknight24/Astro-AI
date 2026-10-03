# Contributing

## Layout

Three packages, each with its own manifest and its own toolchain
([ADR-001](decisions/ADR-001-service-topology.md)):

```
web/      React 19 + Vite 6 + Tailwind 4   (the SPA)
api/      Express + TypeScript             (the only public entry point)
science/  FastAPI + Python 3.12            (physics, SGP4 — internal)
db/       SQL migrations, run by hand in the Supabase SQL editor
docs/     architecture, API, ADRs, failure modes
```

## Development setup

Node ≥ 20 (see `.nvmrc`) and Python 3.12.

```bash
# 1. Environment. Values live in per-package env files, never at the repo root.
cp .env.example api/.env      # fill SUPABASE_URL, DATABASE_URL, GEMINI_API_KEY, SCIENCE_URL
cp .env.example web/.env      # fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

# 2. Science service (terminal 1) — the API fails fast without SCIENCE_URL
#    Use a virtualenv: the service pins fastapi/pymupdf/sgp4 versions, and a
#    system python that happens to have different ones will pass tests locally
#    and fail in the container.
cd science
python3 -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/uvicorn main:app --port 8000

# 3. API (terminal 2)
cd api && npm ci && npm run dev          # http://localhost:3001

# 4. Web (terminal 3)
cd web && npm ci && npm run dev          # http://localhost:5173, proxies /api to 3001
```

`docker-compose up` runs `api` + `science` together when you only need the
backend pair.

### Database

Migrations in `db/migrations/` are applied **by hand in the Supabase SQL
editor**, in numeric order. They are written to be idempotent (`if not exists`)
and additive. Every code path that touches Postgres degrades gracefully when a
table is missing, so a forgotten migration shows up as a logged warning rather
than a 500 — check the logs if caching or tracing seems inert.

## Verification (run before every PR)

```bash
cd api     && npx eslint src/ scripts/ && npx tsc --noEmit && npm test && npm run build
cd web     && npx eslint src/          && npx tsc --noEmit && npm run build
cd science && ./.venv/bin/pytest -q
cd evals   && ../science/.venv/bin/pytest -q
```

That is exactly what CI runs. **No test requires network, a database, or an API
key** — the model client, `fetch` and the pg pool are injected or mocked, and the
ISS tests are served a committed TLE fixture. A test that reaches the network is
a bug in the test.

### Running the agent by hand

```bash
cd api
npx tsx scripts/agent-cli.ts "orbital period of a satellite at 400 km?"
npx tsx scripts/agent-cli.ts --json "..." | jq .trace       # machine-readable
npx tsx scripts/adversarial.ts                              # the failure-mode suite
```

`adversarial.ts` is resumable: results accumulate in `scripts/.out/`, and it
skips cases already recorded. Gemini's free tier caps `generateContent` at 20
requests/day **per model** and a few per minute; one agent run costs three model
calls. The runner waits out per-minute limits and stops cleanly on a per-day cap,
so continue a run later or with `AGENT_MODEL=<another-model>`.

## Code conventions

- **TypeScript is `strict`** in both Node packages. No `@ts-ignore`; narrow
  `unknown` instead of reaching for `any`.
- **Validation at every boundary.** Zod in `api/`, Pydantic in `science/`. The
  duplication is deliberate — each service defends its own door.
- **Never let the model compute.** Numbers come from `science/orbital.py` or a
  cited API. If you are adding a calculation, it goes in the engine with tests,
  not in a prompt.
- **New agent tool?** Add one entry to `api/src/agent/tools.ts` with its schema,
  timeout, retry budget and executor. The loop never names a tool, so nothing
  else changes. State units in the description — unit drift is the failure mode
  that actually happens.
- **Prompt changed?** Bump `PROMPT_VERSION` in `api/src/agent/contract.ts` and say
  why in the comment. Traces and eval runs are compared by that string.
- **Components** live in `web/src/components/`, one feature per file, default
  export, PascalCase filename. Shared types in `web/src/types.ts`.
- **Styling**: Tailwind utilities in feature components; `App.tsx` and
  `LandingPage.tsx` use inline style objects (the landing page is a 1:1 port of a
  design bundle — keep it that way for diffability against the source).
- **Comments explain *why*** — design constraints, measured behaviour,
  workarounds — not *what*. Match the surrounding density.
- **Documentation ships with the change.** A feature that alters behaviour updates
  `docs/API.md` / `docs/ARCHITECTURE.md`; a decision with a real tradeoff gets an
  ADR in `docs/decisions/`.

## Things to know before touching the landing page

- All animation runs in **one** `requestAnimationFrame` loop; never gate
  visibility on CSS keyframes.
- The `useEffect` cleanup must **not** call `renderer.forceContextLoss()` — under
  StrictMode the effect remounts on the same canvas and a force-lost WebGL
  context cannot be re-acquired (renders a broken page in dev).
- Scene textures live in `web/public/assets/` and are referenced by absolute path.
- The root uses `overflow-x: clip` (not `hidden` — `hidden` breaks `position: sticky`).

## Branching & PRs

- Branch from `main`; name `feat/…`, `fix/…`, `docs/…`.
- Conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`).
- PR body: what changed, why, and how it was verified — with the actual command
  output for anything measured. `main` stays deployable and merges need green CI.
- **Never commit `.env`.** Only `.env.example` is tracked, and it lists variable
  names with no values.
