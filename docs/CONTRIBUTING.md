# Contributing

## Development setup

```bash
# Node.js >= 20 required (tsx's ESM loader breaks on 18)
npm install
cp .env.example .env      # set GEMINI_API_KEY
npm run dev               # http://localhost:3000
```

`npm run dev` runs `tsx server.ts` — Express with Vite in middleware mode, so frontend and API share port 3000 with HMR.

## Verification (run before every PR)

```bash
npm run lint     # tsc --noEmit — must pass clean
npm run build    # both bundles must build
```

There is no test suite yet. When adding one, start where correctness is cheapest to pin down: the orbital-calculator math and the API route validation (once zod schemas exist).

## Code conventions

- **TypeScript, non-strict.** The project deliberately runs without `strict`; don't introduce `@ts-ignore` — fix types with explicit annotations instead (e.g. `const motion: string = …` to avoid literal-type narrowing).
- **Components** live in `src/components/`, one feature per file, default export, PascalCase filename matching the component.
- **Shared types** go in `src/types.ts`.
- **Styling**: Tailwind utility classes in the dashboard tools; the landing page intentionally uses inline style objects (it is a 1:1 port of a design bundle — keep it that way for diffability against the source design).
- **API routes**: keep the established pattern in `server.ts` — one `app.post` block per feature, `responseSchema` for JSON-shaped outputs, try/catch with a console.error and a JSON error body.
- **Comments**: match the existing density — explain *why* (design constraints, ports, workarounds), not *what*.

## Things to know before touching the landing page

- All animation runs in **one** `requestAnimationFrame` loop; never gate visibility on CSS keyframes.
- The `useEffect` cleanup must **not** call `renderer.forceContextLoss()` — under React StrictMode the effect remounts on the same canvas, and a force-lost WebGL context can't be re-acquired (renders a white/broken page in dev).
- Scene textures live in `public/assets/` and are referenced by absolute path (`/assets/…`).
- The root uses `overflow-x: clip` (not `hidden` — `hidden` breaks `position: sticky`).

## Branching & PRs

- Branch from `main`; name `feat/…`, `fix/…`, `docs/…`.
- Commits: conventional-style prefixes (`feat:`, `fix:`, `chore:`, `docs:`) as in the existing history.
- PR body: what changed, why, and how it was verified. Link issues.
- `main` should stay deployable; once CI exists (see [DEPLOYMENT.md](DEPLOYMENT.md) Phase 3), merges require a green pipeline.

## Environment gotchas

- Port 3000 conflicts: another dev instance may already be running from a different checkout/worktree.
- `DISABLE_HMR=true` disables HMR *and* file-watching (used by AI Studio) — don't set it for normal development.
- PDF/asset payloads: `/api/image/edit` accepts up to 20 MB JSON bodies; keep test images small.
