# Running AstroAI locally

A working local stack with no cloud accounts: real PostgreSQL, real pgvector,
real JWT verification. The only thing it cannot do is sign a human in — see
[Switching to Supabase](#switching-to-supabase) for that.

Verified end to end on 2026-10-11: rate limiting, idempotency, paper ingestion,
pgvector retrieval, cited answers, agent traces and admin metrics all exercised
against this setup.

---

## 1 · Prerequisites

```bash
node -v        # 22.x — see .nvmrc
python3 -V     # 3.11+ (3.14 verified)
brew -v
```

## 2 · Database

PostgreSQL 17 with pgvector. Port **5433**, not 5432, so this cannot collide
with a Postgres you already run:

```bash
brew install postgresql@17 pgvector
echo 'port = 5433' >> /opt/homebrew/var/postgresql@17/postgresql.conf
brew services start postgresql@17
```

Create the database and its extensions:

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
createdb -h 127.0.0.1 -p 5433 astroai
psql -h 127.0.0.1 -p 5433 -d astroai -c 'create extension if not exists vector; create extension if not exists pgcrypto;'
```

**The auth shim.** Migration 001 declares `public.users.id references
auth.users(id)`. On Supabase that schema is provided by the platform; on a plain
server it does not exist and 001 fails with `schema "auth" does not exist`. Apply
the stand-in first — **local only, never against Supabase**:

```bash
psql -h 127.0.0.1 -p 5433 -d astroai -f db/local/auth-shim.sql
```

Then the migrations:

```bash
cd api && npm run migrate            # --dry-run to preview
```

The runner records each file with a SHA-256 in `public.schema_migrations`, so it
is safe to re-run and it refuses to continue if an already-applied migration has
been edited underneath it.

## 3 · Environment

`api/.env` (never committed — `.gitignore` covers `.env*`):

```ini
DATABASE_URL=postgresql://<you>@127.0.0.1:5433/astroai
SUPABASE_URL=http://127.0.0.1:8899     # the local JWKS, see step 5
SCIENCE_URL=http://127.0.0.1:8000
WEB_ORIGIN=http://localhost:5173
GEMINI_API_KEY=<your key>
ADMIN_USER_IDS=11111111-1111-4111-8111-111111111111
```

Everything else is optional and documented in `.env.example`. `NASA_API_KEY`
falls back to NASA's shared `DEMO_KEY`; Sentry stays off without a DSN.

## 4 · Python service

```bash
cd science
/usr/local/bin/python3 -m venv .venv      # 3.14; 3.9 cannot resolve sgp4==2.27
./.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

## 5 · Auth, without Supabase

`requireAuth` verifies tokens against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
Serve that locally and the **real, unmodified** middleware works — jose, the JWKS
fetch, its cache and the signature check all run:

```bash
node api/scripts/local-auth.mjs --ttl 36000    # prints a token on stdout
```

Deliberately not an auth bypass flag: a bypass would exercise a code path that
does not exist in production. Verified to reject a token signed by a different
key even when the `kid` matches.

## 6 · Run it

```bash
cd api && npm run dev          # :3001  (PORT=3101 to avoid a clash)
cd web && npm run dev          # :5173
```

Smoke test:

```bash
TOKEN=$(node api/scripts/local-auth.mjs --ttl 3600)
curl -s localhost:3001/api/calculate/period \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"altitude_km":400}'
# {"period_min":92.56040452087046, ...}
```

---

## What works locally, and what does not

| | Local stack | Needs Supabase |
|---|---|---|
| Physics engine, ISS tracking | ✅ | |
| Agent loop, tools, guardrails, traces | ✅ | |
| Paper upload, chunking, embeddings, pgvector retrieval, cited answers | ✅ | |
| Rate limiting, idempotency, admin metrics | ✅ | |
| **Human sign-in through the web UI** | ❌ | ✅ |
| **Storing the original PDF for re-download** | ❌ | ✅ (Storage bucket) |
| Deployment | ❌ | ✅ |

The web app authenticates through `supabase-js`, so the local JWKS gets you an
API token but not a browser session. API and CLI paths are fully usable.

---

## Switching to Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is enough).
2. **Project Settings → API**: copy the project URL, the `anon` key and the
   `service_role` key.
3. Fill in `api/.env`:
   ```ini
   DATABASE_URL=<Settings → Database → Connection string → URI>
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # secret, server-side only
   SUPABASE_STORAGE_BUCKET=papers
   ```
   and `web/.env`:
   ```ini
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_API_URL=http://localhost:3001
   ```
4. In the SQL editor, enable pgvector: `create extension if not exists vector;`
5. Apply the migrations — **do not** apply `db/local/auth-shim.sql`:
   ```bash
   cd api && DATABASE_URL='<supabase uri>' npm run migrate
   ```
6. **Storage → New bucket** named `papers`, private.
7. **Authentication → Providers**: enable Email, and Google if you want the
   "Continue with Google" button on the login page to work.

Rotate any key that has ever been pasted somewhere shared. The `service_role`
key bypasses row-level security — it belongs only in server-side environment
variables, never in `web/`.
