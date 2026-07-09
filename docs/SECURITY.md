# Security

## Current posture (honest assessment)

**Safe today:**
- The Gemini API key lives server-side only (`server.ts`); the browser never sees it.
- `.env*` is gitignored (only `.env.example` is tracked); no secrets in the repo history.
- Structured-output endpoints constrain the model with `responseSchema`, limiting response-shape surprises.
- No user accounts and no stored PII — there is currently nothing to breach *at rest*.

**Not safe for public exposure yet:**

| Gap | Risk | Fix |
|---|---|---|
| No rate limiting | Anyone can loop requests and drain the Gemini budget (image endpoints are the most expensive) | `express-rate-limit`: global bucket + strict bucket on `/api/image/*` |
| No input validation | Oversized `paperText`/`history`, negative `count`, junk types → cost amplification and 500 noise | `zod` schemas per route; length caps; `count` ≤ 5 |
| Global 20 MB JSON body | Memory-pressure DoS vector on every route | Per-route limits; 20 MB only where images are uploaded |
| Raw `error.message` in 500s | Can leak provider/quota/internal details | Generic client message; details to server logs only |
| No `helmet` / CSP / CORS policy | Default Express headers; any origin can call the API | `helmet` + same-origin CORS |
| Boots with `MOCK_KEY` when unconfigured | Misconfigured prod looks "up" but every AI call fails opaquely | Fail fast in production when `GEMINI_API_KEY` is missing |
| No auth / usage identity | Cannot attribute abuse, enforce quotas, or gate premium features | Phase 6: Firebase Auth + per-user quotas (per product plan) |

## Prompt-injection considerations

User text is interpolated directly into prompts (`topic`, `missionName`, `paperText`, chat `message`). With no tools/functions wired to the model the blast radius is content quality, not data access — a user can jailbreak *their own* response. This becomes a real concern the moment RAG over shared documents or tool use is added (roadmap Phase 6): revisit with context isolation and output filtering then.

## Operational rules

1. **Never** commit `.env`; keys go in the host's secret store.
2. Rotate `GEMINI_API_KEY` if it ever appears in a log, paste, or screenshot.
3. Set a spending cap / budget alert on the Google account before public launch.
4. Dependency hygiene: `npm audit` in CI; Dependabot on.
5. Before launch, walk the OWASP Top 10 against the checklist above (the Cosmos plan schedules this in Sprint 7).

## Reporting

No formal disclosure process pre-launch. Add a `security.txt` + contact once public.
