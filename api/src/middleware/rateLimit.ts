/**
 * Per-user and per-IP rate limiting.
 *
 * DECISION (ADR-008): fixed-window counters in Postgres, one atomic upsert per
 * request. Per-user limits must hold across instances — an in-memory counter on
 * a two-instance deploy silently doubles every limit — and Postgres is already
 * the shared store (ADR-002). One indexed upsert is cheap next to the three
 * model calls the limit exists to protect.
 *
 * DECISION: **fail open.** If the counter cannot be read or written, the request
 * is allowed and the failure is logged. A database blip should not lock every
 * student out of a tutoring app, and the spend risk it guards is already bounded
 * by authentication — every `/api/*` route requires a verified Supabase JWT, so
 * an attacker needs an account before they can cost anything. The honest cost of
 * this choice is that a Postgres outage is also a rate-limit outage; that
 * tradeoff is revisited if the key ever becomes unmetered.
 *
 * Both dimensions are checked: per-user catches one account looping a request,
 * per-IP catches many throwaway accounts behind one host.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../lib/db";

export interface RateLimitRule {
  /** Bucket name, so an expensive route does not consume the cheap allowance. */
  bucket: string;
  /** Requests permitted per window, per key. */
  limit: number;
  windowMs: number;
}

/**
 * Buckets, ordered cheapest to most expensive.
 *
 * The numbers are set from what the work costs, not from a round figure:
 *  - `agent`  : 3+ model calls per request. 10/hour/user is ~30 model calls,
 *               which is already more than the free tier's daily allowance.
 *  - `upload` : PDF extraction plus an embedding call per 32 chunks. 10/hour
 *               covers a study session; 100 would be a scraper.
 *  - `api`    : everything else, dominated by the deterministic calculator,
 *               which is microseconds of CPU. Generous on purpose.
 */
export const RATE_LIMITS: Record<"api" | "agent" | "upload", RateLimitRule> = {
  api: { bucket: "api", limit: 300, windowMs: 60_000 },
  agent: { bucket: "agent", limit: 10, windowMs: 3_600_000 },
  upload: { bucket: "upload", limit: 10, windowMs: 3_600_000 },
};

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the current window ends. */
  resetAt: number;
  /** Which key tripped the limit, for the log line. */
  trippedKey?: string;
  /** True when the store could not be reached and the request was let through. */
  degraded?: boolean;
}

/** Minimal store surface, so tests can run against PGlite. */
export interface CounterStore {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Increment and test one key. Returns the post-increment count.
 *
 * A single statement: the upsert and the read are the same round trip, and the
 * increment is atomic, so two concurrent requests cannot both see the same count.
 */
async function bump(
  store: CounterStore,
  bucket: string,
  key: string,
  start: Date,
): Promise<number> {
  const { rows } = await store.query<{ count: number }>(
    `INSERT INTO public.rate_limit_counters (bucket, key, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (bucket, key, window_start)
       DO UPDATE SET count = public.rate_limit_counters.count + 1
     RETURNING count`,
    [bucket, key, start],
  );
  return Number(rows[0]?.count ?? 1);
}

export async function checkRateLimit(
  store: CounterStore,
  rule: RateLimitRule,
  keys: string[],
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const start = windowStart(now, rule.windowMs);
  const resetAt = Math.floor((start.getTime() + rule.windowMs) / 1000);

  try {
    let worst = 0;
    let trippedKey: string | undefined;
    for (const key of keys) {
      const count = await bump(store, rule.bucket, key, start);
      if (count > worst) {
        worst = count;
        trippedKey = key;
      }
    }
    const remaining = Math.max(rule.limit - worst, 0);
    return {
      allowed: worst <= rule.limit,
      limit: rule.limit,
      remaining,
      resetAt,
      trippedKey: worst > rule.limit ? trippedKey : undefined,
    };
  } catch (err) {
    console.error(
      `rate limit store unavailable for bucket '${rule.bucket}':`,
      err,
    );
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetAt,
      degraded: true,
    };
  }
}

/**
 * The client's address.
 *
 * Express only trusts `X-Forwarded-For` when `trust proxy` is set, which the
 * server does in production. Without it, `req.ip` is the proxy's address and
 * per-IP limiting would bucket every user together — so the header is never read
 * directly here.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function rateLimitKeys(req: Request): string[] {
  const keys = [`ip:${clientIp(req)}`];
  if (req.auth?.userId) keys.unshift(`user:${req.auth.userId}`);
  return keys;
}

export function rateLimit(rule: RateLimitRule, store: CounterStore = pool) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const decision = await checkRateLimit(store, rule, rateLimitKeys(req));

    // Draft RFC headers: clients and dashboards both read these.
    res.setHeader("RateLimit-Limit", String(decision.limit));
    res.setHeader("RateLimit-Remaining", String(decision.remaining));
    res.setHeader("RateLimit-Reset", String(decision.resetAt));

    if (decision.allowed) {
      next();
      return;
    }

    const retryAfter = Math.max(
      decision.resetAt - Math.floor(Date.now() / 1000),
      1,
    );
    res.setHeader("Retry-After", String(retryAfter));
    console.warn(
      `rate limit '${rule.bucket}' exceeded by ${decision.trippedKey} on ${req.method} ${req.originalUrl}`,
    );
    res.status(429).json({
      error: `Rate limit exceeded for this ${rule.bucket === "api" ? "API" : rule.bucket} allowance. Try again in ${retryAfter}s.`,
      retry_after_seconds: retryAfter,
    });
  };
}

/**
 * Delete windows that can no longer be current.
 *
 * Called opportunistically rather than on a schedule: the table is tiny and
 * adding a cron job for it would be more infrastructure than the problem needs.
 */
export async function sweepRateLimits(
  store: CounterStore = pool,
  olderThanMs = 24 * 3_600_000,
): Promise<number> {
  const { rows } = await store.query<{ n: string }>(
    `WITH deleted AS (
       DELETE FROM public.rate_limit_counters WHERE window_start < $1 RETURNING 1
     ) SELECT count(*) AS n FROM deleted`,
    [new Date(Date.now() - olderThanMs)],
  );
  return Number(rows[0]?.n ?? 0);
}
