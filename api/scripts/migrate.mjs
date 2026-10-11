/**
 * Apply db/migrations/*.sql in order, exactly once each.
 *
 *   cd api && npm run migrate
 *   cd api && npm run migrate -- --dry-run
 *   DATABASE_URL=... node api/scripts/migrate.mjs
 *
 * Until now the documented procedure was to paste each file into Supabase's SQL
 * editor in order (docs/DEPLOYMENT.md). That works once, by hand, for one
 * environment -- it does not give a local developer a database, and it has no
 * record of what has already been applied, so re-running is the operator's
 * problem to remember.
 *
 * Each file runs inside a transaction together with the insert that records it,
 * so a failure leaves neither a half-applied migration nor a false record of
 * one. Files are identified by name, and a file whose contents change after it
 * has been applied is reported rather than silently skipped: editing an applied
 * migration means two environments have silently diverged.
 */
// Same convention as the other scripts: DATABASE_URL normally comes from
// api/.env, so run this from the api directory (npm run migrate does).
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ../../db/migrations -- the SQL stays with the schema it describes; this
// runner lives under api/ because `pg` is an api dependency and Node resolves
// bare imports from the importing file's own location.
const MIGRATIONS_DIR = path.resolve(HERE, "..", "..", "db", "migrations");
const dryRun = process.argv.includes("--dry-run");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required. Set it in api/.env or the environment.");
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 001_, 002_, ... -- zero-padded, so lexical order is apply order

if (files.length === 0) {
  console.error(`No .sql files in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename    text primary key,
      sha256      text not null,
      applied_at  timestamptz not null default now()
    )
  `);
  // Every other table in public has RLS on with no policies (see the
  // migrations). Matching that is not ceremony: on Supabase an RLS-less table
  // in `public` is reachable through PostgREST, so leaving this one open would
  // publish the schema history to anonymous callers. The migration runner
  // connects as the owner, which RLS does not restrict.
  await client.query(
    "alter table public.schema_migrations enable row level security",
  );

  const { rows } = await client.query(
    "select filename, sha256 from public.schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.filename, r.sha256]));

  let ran = 0;
  for (const filename of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(filename);

    if (previous !== undefined) {
      if (previous !== sha256) {
        console.error(
          `! ${filename} was applied earlier but its contents have changed.\n` +
            "  Applied migrations are immutable -- add a new migration instead.",
        );
        process.exitCode = 1;
      } else {
        console.log(`  ${filename} (already applied)`);
      }
      continue;
    }

    if (dryRun) {
      console.log(`+ ${filename} (would apply, ${sql.length} bytes)`);
      ran += 1;
      continue;
    }

    process.stdout.write(`+ ${filename} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (filename, sha256) values ($1, $2)",
        [filename, sha256],
      );
      await client.query("commit");
      console.log("ok");
      ran += 1;
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${filename} failed, and was rolled back:\n${err.message}`);
      process.exit(1);
    }
  }

  console.log(
    dryRun
      ? `\n${ran} migration(s) would be applied.`
      : `\n${ran} migration(s) applied, ${files.length - ran} already present.`,
  );
} finally {
  await client.end();
}
