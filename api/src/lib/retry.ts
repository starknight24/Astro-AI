/**
 * Exponential backoff with full jitter.
 *
 * Used for third-party calls that fail transiently. Measured motivation: three
 * consecutive probes of api.nasa.gov/planetary/apod during Week 4 returned
 * timeout, 200, and 500 — retrying is the difference between a working tool and
 * a coin flip. Only transient failures are retried; a 4xx is a bug in our
 * request and retrying it just burns the budget.
 */

export interface RetryOptions {
  /** Retries *after* the first attempt. 2 => up to 3 total attempts. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether an error is worth another attempt. Default: always. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /**
   * Server-provided delay, in ms, overriding the computed backoff.
   *
   * Exists because guessing is worse than reading: Gemini's 429 carries
   * `"retryDelay":"27s"` and a jittered 465 ms retry against it simply fails
   * again, three times, for nothing. Return null to fall back to the backoff.
   */
  delayFor?: (err: unknown, attempt: number) => number | null;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class RetryableError extends Error {
  readonly retryable = true;
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    shouldRetry = () => true,
    delayFor,
    onRetry,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt === retries;
      if (isLast || !shouldRetry(err, attempt)) throw err;
      const suggested = delayFor?.(err, attempt) ?? null;
      let delay: number;
      if (suggested !== null && Number.isFinite(suggested) && suggested > 0) {
        delay = Math.floor(suggested);
      } else {
        // Full jitter: delay ∈ [0, min(max, base * 2^attempt)].
        const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        delay = Math.floor(random() * ceiling);
      }
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Parse Gemini's own retry hint out of an error.
 *
 * A 429 body carries `{"@type": "...RetryInfo", "retryDelay": "27s"}`. Capped at
 * 120 s so a pathological hint cannot hang a request indefinitely, and padded by
 * a second because retrying at the exact boundary tends to fail again.
 */
const RETRY_DELAY_HINT = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/;
const MAX_HINTED_DELAY_MS = 120_000;

export function serverRetryDelayMs(err: unknown): number | null {
  const text = err instanceof Error ? err.message : String(err);
  const match = RETRY_DELAY_HINT.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000 + 1000, MAX_HINTED_DELAY_MS);
}
