/**
 * Idempotency keys for expensive mutations.
 *
 * A client that retries `POST /api/papers` after a timeout must not get a second
 * ingestion, and a retried `POST /api/agent/solve` must not spend a second set of
 * model calls. The key makes the retry safe:
 *
 *   first request  -> row inserted as 'in_progress', handler runs, response stored
 *   retry          -> stored response replayed, handler never runs
 *   concurrent     -> 409, because the first one has not finished yet
 *   same key, different body -> 422, because that is a client bug, not a retry
 *
 * DECISION (ADR-008): the request body is hashed and compared. Returning the
 * first response for a *different* body would silently answer the wrong
 * question and hide the reused key.
 *
 * DECISION: **fail open**, like rate limiting. If the store is unreachable the
 * handler runs unprotected rather than the request failing — the failure mode of
 * a missed idempotency check is a duplicate, and the failure mode of refusing is
 * an outage. Logged either way.
 *
 * Paper uploads additionally dedupe on the SHA-256 of the file (ADR-006), so a
 * client that sends no key still cannot create a duplicate paper. This middleware
 * is the generic mechanism; that one is the domain-specific backstop.
 */
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../lib/db";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 200;
const MIN_KEY_LENGTH = 8;

/** Minimal store surface, so tests can run against PGlite. */
export interface IdempotencyStore {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function bodyHash(body: unknown): string {
  // Key order must not change the hash: a client serialising the same object
  // differently is still sending the same request.
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export type IdempotencyOutcome =
  | { kind: "proceed" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" }
  | { kind: "body_mismatch" }
  | { kind: "degraded" };

interface ExistingRow {
  state: "in_progress" | "completed" | "failed";
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export async function claimKey(
  store: IdempotencyStore,
  key: string,
  userId: string,
  route: string,
  hash: string,
): Promise<IdempotencyOutcome> {
  try {
    // Insert-or-nothing first: if this wins, we own the request. One statement,
    // so two concurrent retries cannot both think they are first.
    const inserted = await store.query<{ key: string }>(
      `INSERT INTO public.idempotency_keys (key, user_id, route, request_hash, state)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (key, user_id, route) DO NOTHING
       RETURNING key`,
      [key, userId, route, hash],
    );
    if (inserted.rows.length > 0) return { kind: "proceed" };

    const { rows } = await store.query<ExistingRow>(
      `SELECT state, request_hash, response_status, response_body
         FROM public.idempotency_keys
        WHERE key = $1 AND user_id = $2 AND route = $3`,
      [key, userId, route],
    );
    const existing = rows[0];
    if (!existing) return { kind: "proceed" }; // raced with a delete; treat as new

    if (existing.request_hash !== hash) return { kind: "body_mismatch" };
    if (existing.state === "in_progress") return { kind: "in_progress" };
    if (existing.state === "completed" && existing.response_status !== null) {
      return {
        kind: "replay",
        status: existing.response_status,
        body: existing.response_body,
      };
    }
    // A previous attempt failed. Let this one try again rather than replaying a
    // failure forever: the point of a retry is that the first one did not work.
    await store.query(
      `UPDATE public.idempotency_keys
          SET state = 'in_progress', response_status = NULL, response_body = NULL, completed_at = NULL
        WHERE key = $1 AND user_id = $2 AND route = $3`,
      [key, userId, route],
    );
    return { kind: "proceed" };
  } catch (err) {
    console.error(`idempotency store unavailable for ${route}:`, err);
    return { kind: "degraded" };
  }
}

export async function recordOutcome(
  store: IdempotencyStore,
  key: string,
  userId: string,
  route: string,
  status: number,
  body: unknown,
): Promise<void> {
  // 5xx is recorded as failed, not completed: replaying a server error to every
  // retry would turn one transient fault into a permanent one.
  const state = status >= 500 ? "failed" : "completed";
  try {
    await store.query(
      `UPDATE public.idempotency_keys
          SET state = $4, response_status = $5, response_body = $6::jsonb, completed_at = now()
        WHERE key = $1 AND user_id = $2 AND route = $3`,
      [key, userId, route, state, status, JSON.stringify(body ?? null)],
    );
  } catch (err) {
    console.error(`idempotency outcome not recorded for ${route}:`, err);
  }
}

/**
 * Middleware. The header is **optional**: without it the handler runs normally,
 * because forcing every client to generate keys would break the existing UI for
 * no safety gain on read-mostly routes.
 */
export function idempotency(route: string, store: IdempotencyStore = pool) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const raw = req.header(IDEMPOTENCY_HEADER);
    if (!raw) {
      next();
      return;
    }
    const key = raw.trim();
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      res.status(400).json({
        error: `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
      });
      return;
    }
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const hash = bodyHash(req.body);
    const outcome = await claimKey(store, key, userId, route, hash);

    switch (outcome.kind) {
      case "replay":
        res.setHeader("Idempotent-Replay", "true");
        res.status(outcome.status).json(outcome.body);
        return;
      case "in_progress":
        res.setHeader("Retry-After", "5");
        res.status(409).json({
          error: "A request with this Idempotency-Key is still in progress.",
        });
        return;
      case "body_mismatch":
        res.status(422).json({
          error:
            "This Idempotency-Key was already used with a different request body. Use a new key for a new request.",
        });
        return;
      case "degraded":
        next();
        return;
      case "proceed":
        break;
    }

    // Capture the response so a retry can replay it. res.json is wrapped rather
    // than res.end so the body is still a value, not a buffer to re-parse.
    const originalJson = res.json.bind(res);
    let recorded = false;
    res.json = (body: unknown) => {
      if (!recorded) {
        recorded = true;
        void recordOutcome(store, key, userId, route, res.statusCode, body);
      }
      return originalJson(body);
    };
    // A handler that ends without json() (a 204) still must not leave the row
    // 'in_progress' forever, or every retry would get a 409.
    res.on("finish", () => {
      if (!recorded) {
        recorded = true;
        void recordOutcome(store, key, userId, route, res.statusCode, null);
      }
    });
    next();
  };
}
