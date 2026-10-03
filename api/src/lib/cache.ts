/**
 * TTL response cache for third-party data (NASA, TLE-derived lookups).
 *
 * DECISION (ADR-005): two layers, no new infrastructure. An in-process Map
 * answers repeat calls inside one request/dyno for free; Postgres (the database
 * the API already owns, per ADR-002's "one database" reasoning) makes the cache
 * survive restarts and stay shared across instances. No Redis: a third service
 * for a 1-hour cache of public data is not worth the operational surface.
 *
 * The Postgres layer is best-effort. If `api_cache` is missing or the database
 * is unreachable the cache silently degrades to memory-only — a cold cache must
 * never turn a working answer into a 500. Same posture as `upsertUser`.
 */
import { pool } from "./db";

export const ONE_HOUR_MS = 60 * 60 * 1000;

/** Bound on the in-process layer; entries are evicted oldest-first. */
const MAX_MEMORY_ENTRIES = 500;

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

/** Logged once per process so a missing table does not flood the logs. */
let pgCacheWarned = false;

function warnPgOnce(err: unknown): void {
  if (pgCacheWarned) return;
  pgCacheWarned = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `api_cache unavailable, falling back to in-memory cache only: ${message}`,
  );
}

function memoryGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  // Refresh insertion order so hot keys survive eviction.
  memory.delete(key);
  memory.set(key, hit);
  return hit.value as T;
}

function memorySet(key: string, value: unknown, expiresAt: number): void {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const local = memoryGet<T>(key);
  if (local !== null) return local;

  try {
    const { rows } = await pool.query<{ value: T; expires_at: Date }>(
      "SELECT value, expires_at FROM public.api_cache WHERE key = $1 AND expires_at > now()",
      [key],
    );
    if (rows.length === 0) return null;
    memorySet(key, rows[0].value, rows[0].expires_at.getTime());
    return rows[0].value;
  } catch (err) {
    warnPgOnce(err);
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlMs: number = ONE_HOUR_MS,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  memorySet(key, value, expiresAt);
  try {
    await pool.query(
      `INSERT INTO public.api_cache (key, value, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value), new Date(expiresAt)],
    );
  } catch (err) {
    warnPgOnce(err);
  }
}

export interface CachedResult<T> {
  value: T;
  cached: boolean;
}

/**
 * Return a cached value or compute, store and return a fresh one.
 * `cached` is surfaced to callers so the agent trace can show provenance.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<CachedResult<T>> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return { value: hit, cached: true };
  const value = await compute();
  await cacheSet(key, value, ttlMs);
  return { value, cached: false };
}

/** Test/maintenance helper: drop the in-process layer. */
export function clearMemoryCache(): void {
  memory.clear();
}
