# ADR-004: Authentication via Supabase JWTs Verified at the API

**Status:** Accepted · **Date:** 2026-07-20 (recorded retrospectively 2026-10-02)

> Recorded late. The decision was made and shipped in Week 2 (commit `8c9429c`,
> "feat: end-to-end auth") but never written down, which the Week-8 ADR sweep
> caught. Written now from the code and the commit history rather than pretended
> to be contemporaneous.

## Context

Every `/api/*` route proxies to a metered API — Gemini for the agent, NASA for
tools — so an unauthenticated deployment is an open invitation to drain the
budget. The product also needs per-user data (uploaded papers, conversation
threads, quiz history), which requires a stable user identity.

The original product plan specified **Firebase Auth**. The project had already
chosen Supabase Postgres for persistence ([ADR-002](ADR-002-pgvector-vs-pinecone.md)),
and this decision re-examined that default. Constraints: a solo developer, a
React SPA on Vercel and a separate Express API on Render — two origins, so
cookie-based sessions would need cross-site cookie handling.

## Decision

**Supabase Auth issues the JWT; the Express API verifies it against Supabase's
JWKS; `public.users.id` references `auth.users(id)`.**

Three reasons, in order of weight:

1. **One identity, one database, no sync.** `public.users.id` is a foreign key to
   `auth.users(id)`, so the auth identity and the application's rows share a
   primary key. With Firebase the identity would live in Google's system and
   every table would carry a Firebase UID string with no referential integrity —
   and a deleted user would leave orphans rather than cascading.
2. **No second vendor.** Supabase was already the database. Firebase Auth would
   have added an account, an SDK, a second console and a second failure mode for
   the one thing that gates every request.
3. **Asymmetric verification, no shared secret.** `jose` fetches Supabase's
   public JWKS and verifies RS256 signatures. The API never holds a signing key,
   so there is no symmetric secret to leak, rotate or accidentally commit.

**Bearer tokens, not cookies.** The SPA and API are on different origins
(Vercel/Render), so a cookie session would need `SameSite=None; Secure`,
third-party-cookie tolerance, and CSRF protection. An `Authorization` header
attached by `web/src/lib/api.ts` avoids all three — and CSRF does not apply to a
header a browser never sends automatically.

**Verification at the API, not in the database.** Row Level Security is enabled
on every table with **no policies**, i.e. deny-all through Supabase's public
PostgREST API. The browser never talks to Postgres; only the API does, with a
connection that bypasses RLS, and it filters by `user_id` in every query. One
place enforces authorisation instead of two half-places.

**The user row is created lazily**, by an upsert on the first authenticated
request, and its failure is logged rather than fatal: a database blip should
degrade to "no user row yet", not "nobody can sign in".

## Alternatives Considered

**Firebase Auth** (what the plan specified). More mature, more providers, better
documented. Rejected on identity-split: the UID would be an unenforceable string
in every table, and a second vendor gates every request for no gain the project
needs.

**Roll our own** (password hashing, sessions, reset flow). Rejected flatly —
it is a large surface of well-known mistakes, and an entire category of bug this
codebase now simply cannot have.

**RLS policies instead of API-side filtering.** Genuinely attractive: the
database would enforce ownership even if a route forgot its `WHERE`. Rejected
because the API connects as service-role (it must, to write traces for
unauthenticated failures and to run the eval harness), so RLS would be bypassed
anyway; writing policies that only apply to a path nobody uses would be
security theatre. The cost of this choice is real and accepted: **a route that
forgets `user_id = $1` has no backstop**, which is why ownership is asserted by
test for every read path (`pipeline.test.ts`, `store.test.ts`).

**Verifying with the shared JWT secret** rather than JWKS. Simpler, one fewer
network dependency. Rejected: it puts a symmetric secret in the API's
environment, and rotating it means coordinated redeploys.

## Consequences

Authentication is roughly 50 lines (`api/src/middleware/auth.ts`) and the API
holds no credential capable of minting a token. Verified: an unauthenticated or
malformed-token request to any `/api/*` route returns `401`, and `jwtVerify`
costs **0.05 ms p50** with a warm JWKS cache (measured, `docs/load-test.md`) —
auth is not a latency concern.

**Costs accepted:**

- **The API depends on Supabase's JWKS endpoint being reachable.** `jose` caches
  the key set, so a brief outage is survivable, but a cold start during one means
  every request fails. Felt directly during development: when the Supabase project
  became unreachable, no request could be authenticated locally at all — which is
  why load testing needed `api/scripts/local-auth.mjs` to serve a JWKS rather than a
  bypass flag.
- **No backstop under a forgotten `WHERE`** (above), mitigated by tests.
- **Token lifetime is Supabase's to decide**, so revocation is not immediate.
  Acceptable for a tutoring app; it would not be for anything transactional.

**Revisit trigger:** if the project ever needs immediate revocation or
server-side session invalidation, this design cannot provide it and a session
store becomes necessary.
