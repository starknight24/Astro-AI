import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in api/.env.");
}

export const pool = new pg.Pool({ connectionString });

/**
 * Users already known to exist in this process.
 *
 * MEASURED (docs/load-test.md): `requireAuth` ran this upsert on EVERY
 * authenticated request, and a database round trip was 0.90 ms p50 even when it
 * failed at DNS — about a quarter of the API layer's whole overhead, for a
 * statement that is `ON CONFLICT DO NOTHING` and therefore a no-op after the
 * first success.
 *
 * Bounded and TTL'd rather than unbounded: a long-lived process with many users
 * should not grow a set forever, and the TTL means a row deleted out from under
 * us is recreated within the hour instead of never.
 */
const KNOWN_USERS_MAX = 5_000;
const KNOWN_USER_TTL_MS = 60 * 60 * 1000;
const knownUsers = new Map<string, number>();

export async function upsertUser(id: string, email: string): Promise<void> {
  const seenAt = knownUsers.get(id);
  if (seenAt !== undefined && Date.now() - seenAt < KNOWN_USER_TTL_MS) return;

  await pool.query(
    "INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [id, email],
  );

  // Recorded only on success: a failed upsert must be retried on the next
  // request, or a transient outage would leave the row missing indefinitely.
  if (knownUsers.size >= KNOWN_USERS_MAX) {
    const oldest = knownUsers.keys().next().value;
    if (oldest !== undefined) knownUsers.delete(oldest);
  }
  knownUsers.set(id, Date.now());
}

/** Test helper: forget which users are known. */
export function clearKnownUsers(): void {
  knownUsers.clear();
}
