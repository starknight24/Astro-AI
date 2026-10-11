/**
 * Check that this environment is actually wired up, and say what to fix.
 *
 *   cd api && npm run doctor
 *
 * Written for the moment after pasting Supabase credentials in, when the only
 * feedback the app gives is "Failed to fetch" in a browser console. Each check
 * reports the thing it proves, not the variable it read -- a URL being present
 * is not the same as a database answering.
 *
 * It never prints a secret. Values are reported as set/missing, and hosts by
 * name only.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

let failures = 0;
let warnings = 0;

const ok = (label, detail = "") =>
  console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
const warn = (label, detail) => {
  warnings += 1;
  console.log(`  warn  ${label}${detail ? ` — ${detail}` : ""}`);
};
const fail = (label, detail, fix) => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  if (fix) console.log(`        fix: ${fix}`);
};

function section(name) {
  console.log(`\n${name}`);
}

/** Read a .env without exporting it, so web/ vars do not leak into process.env. */
function readEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function reachable(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status, res };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- api/.env

section("api/.env");

const required = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SCIENCE_URL",
  "GEMINI_API_KEY",
];
for (const name of required) {
  if (process.env[name]?.trim()) ok(name, "set");
  else
    fail(name, "missing", `add ${name} to api/.env (see docs/local-setup.md)`);
}
const OPTIONAL = {
  WEB_ORIGIN:
    "optional locally; REQUIRED in production or the API refuses to start",
  ADMIN_USER_IDS:
    "/api/admin/metrics returns 404 until this lists your user id",
  SUPABASE_SERVICE_ROLE_KEY:
    "uploaded PDFs are ingested but not stored for re-download",
  NASA_API_KEY: "falls back to NASA's shared DEMO_KEY, ~30 requests/hour/IP",
  SENTRY_DSN: "error reporting stays disabled",
};
for (const [name, why] of Object.entries(OPTIONAL)) {
  if (process.env[name]?.trim()) ok(name, "set");
  else warn(name, `unset — ${why}`);
}

/** The project ref in a Supabase URL, e.g. https://abc123.supabase.co -> abc123. */
function projectRef(url) {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(url ?? "");
  return m ? m[1] : null;
}

// --------------------------------------------------------------- database

section("database");

// The trap this exists for: SUPABASE_URL moved to a real project while
// DATABASE_URL still pointed at a local server. Every individual check passes
// -- the database answers, the JWKS answers -- but tokens are minted for users
// who do not exist in the database being written to, so `public.users` either
// violates its foreign key or silently fills with rows for the wrong identity
// provider. Nothing in the app says so.
{
  const ref = projectRef(process.env.SUPABASE_URL);
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (ref && dbUrl && !dbUrl.includes(ref)) {
    fail(
      "database/auth match",
      `auth is project '${ref}' but DATABASE_URL does not reference it`,
      "point DATABASE_URL at that project (Settings → Database → Connection string → URI)",
    );
  } else if (ref && dbUrl) {
    ok("database/auth match", `both are project '${ref}'`);
  }

  // node-pg uses prepared statements, which transaction pooling does not
  // support; the symptom is sporadic "prepared statement does not exist".
  if (/:6543\//.test(dbUrl)) {
    warn(
      "pooler port",
      "6543 is the TRANSACTION pooler — use the session pooler or direct connection",
    );
  }
}

if (!process.env.DATABASE_URL?.trim()) {
  fail("connection", "no DATABASE_URL to try");
} else {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const { rows: v } = await client.query("select version() as v");
    ok("connection", v[0].v.split(" ").slice(0, 2).join(" "));

    const { rows: ext } = await client.query(
      "select extname, extversion from pg_extension where extname in ('vector','pgcrypto')",
    );
    const vector = ext.find((e) => e.extname === "vector");
    if (vector) ok("pgvector", `v${vector.extversion}`);
    else
      fail(
        "pgvector",
        "extension not installed",
        "psql <db> -c 'create extension if not exists vector;'",
      );

    const { rows: mig } = await client
      .query("select filename from public.schema_migrations order by filename")
      .catch(() => ({ rows: null }));
    if (mig === null) {
      fail(
        "migrations",
        "schema_migrations missing — nothing has been applied",
        "cd api && npm run migrate",
      );
    } else {
      const expected = 4;
      if (mig.length >= expected) ok("migrations", `${mig.length} applied`);
      else
        fail(
          "migrations",
          `only ${mig.length} of ${expected} applied`,
          "cd api && npm run migrate",
        );
    }

    const { rows: t } = await client.query(
      "select count(*)::int as n, count(*) filter (where rowsecurity)::int as rls from pg_tables where schemaname='public'",
    );
    if (t[0].n === 0)
      fail("tables", "public schema is empty", "cd api && npm run migrate");
    else if (t[0].n === t[0].rls) ok("tables", `${t[0].n} tables, RLS on all`);
    else
      fail(
        "tables",
        `${t[0].n - t[0].rls} of ${t[0].n} tables have RLS OFF`,
        "every table in public must enable row level security",
      );

    const { rows: idx } = await client.query(
      "select count(*)::int as n from pg_indexes where schemaname='public' and indexdef ilike '%hnsw%'",
    );
    if (idx[0].n > 0) ok("vector index", "HNSW present");
    else
      warn(
        "vector index",
        "no HNSW index — retrieval will fall back to a scan",
      );
  } catch (err) {
    fail(
      "connection",
      err instanceof Error ? err.message : String(err),
      "check DATABASE_URL. On Supabase use Settings → Database → Connection string → URI",
    );
  } finally {
    await client.end().catch(() => {});
  }
}

// ------------------------------------------------------------------- auth

section("auth (JWKS)");

const supabaseUrl = process.env.SUPABASE_URL?.trim();
if (!supabaseUrl) {
  fail("JWKS", "no SUPABASE_URL");
} else {
  const jwksUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  const { status, res, error } = await reachable(jwksUrl);
  if (error) {
    fail(
      "JWKS",
      error,
      supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost")
        ? "start it: node api/scripts/local-auth.mjs --ttl 36000"
        : "check the project still exists and SUPABASE_URL is its API URL",
    );
  } else if (status === 200) {
    const body = await res.json().catch(() => null);
    const keys = body?.keys?.length ?? 0;
    if (keys > 0) ok("JWKS", `${keys} key(s) published`);
    else fail("JWKS", "reachable but published no keys");
  } else {
    fail("JWKS", `HTTP ${status}`);
  }
}

// ---------------------------------------------------------------- science

section("science service");

const scienceUrl = process.env.SCIENCE_URL?.trim();
if (!scienceUrl) {
  fail("health", "no SCIENCE_URL");
} else {
  const { status, error } = await reachable(
    `${scienceUrl.replace(/\/$/, "")}/health`,
  );
  if (error)
    fail(
      "health",
      error,
      "cd science && ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000",
    );
  else if (status === 200) ok("health", scienceUrl);
  else fail("health", `HTTP ${status}`);
}

// -------------------------------------------------------------- web/.env

section("web/.env");

const web = readEnvFile(path.join(REPO, "web", ".env"));
if (!web) {
  warn("file", "web/.env not found — the SPA will fail to start");
} else {
  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    if (web[name]?.trim()) ok(name, "set");
    else fail(name, "missing", "see docs/local-setup.md");
  }

  const url = web.VITE_SUPABASE_URL?.trim();
  if (url) {
    const { status, error } = await reachable(
      `${url.replace(/\/$/, "")}/auth/v1/health`,
    );
    if (error) {
      fail(
        "sign-in endpoint",
        error,
        "this is the 'Failed to fetch' on the login page — the project URL does not resolve",
      );
    } else if (status >= 200 && status < 500) {
      ok("sign-in endpoint", `reachable (HTTP ${status})`);
    } else {
      fail("sign-in endpoint", `HTTP ${status}`);
    }

    // The API verifies tokens against SUPABASE_URL's JWKS. If the SPA signs in
    // against a different project, every token it mints is rejected with 401.
    if (
      supabaseUrl &&
      !supabaseUrl.includes("127.0.0.1") &&
      !supabaseUrl.includes("localhost")
    ) {
      const a = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const b = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (a === b) ok("project match", "SPA and API point at the same project");
      else
        fail(
          "project match",
          `SPA signs in to ${a} but the API verifies against ${b}`,
          "these must be the same Supabase project, or every request returns 401",
        );
    }
  }
}

// ----------------------------------------------------------------- result

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s), ${warnings} warning(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
