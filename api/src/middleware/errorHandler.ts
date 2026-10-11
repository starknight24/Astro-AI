/**
 * The final error handler, registered after every route.
 *
 * Without it, a route that throws outside its own try/catch returns Express's
 * default response: an HTML stack trace, with absolute file paths, to the
 * caller. That is both an information leak and a broken contract for a JSON
 * API.
 *
 * DECISION: honour a 4xx that the error carries, and collapse everything else
 * to 500. body-parser attaches `status: 400` to a malformed-JSON SyntaxError,
 * and that is the caller's mistake, not a server fault. Reporting it as 500
 * would tell the client to retry something that can never succeed, spend the
 * 5xx budget the load tests threshold on, and fill Sentry with faults that are
 * not ours. Only a status in 400..499 is trusted; anything else -- including a
 * 3xx or a nonsense number from a dependency -- becomes 500.
 *
 * DECISION: the 5xx message stays generic. An internal failure must not
 * describe itself to the caller. A 4xx may repeat its message, because the
 * caller is the one who can act on it.
 */
import type { NextFunction, Request, Response } from "express";

/** A 4xx carried by the error itself, or null when there is none to trust. */
export function clientErrorStatus(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  const candidate = e?.status ?? e?.statusCode;
  if (typeof candidate !== "number" || !Number.isInteger(candidate))
    return null;
  return candidate >= 400 && candidate <= 499 ? candidate : null;
}

export interface ErrorHandlerDeps {
  /** Injected so a test can assert what would reach Sentry. */
  reportError: (error: unknown, context: Record<string, unknown>) => void;
}

export function errorHandler({ reportError }: ErrorHandlerDeps) {
  return (
    error: unknown,
    req: Request,
    res: Response,
    // Express identifies an error handler by its FOUR-argument signature.
    // Dropping this parameter turns the function into ordinary middleware and
    // errors stop reaching it, so it is named with a leading underscore to
    // satisfy the linter rather than removed.
    _next: NextFunction,
  ): void => {
    const status = clientErrorStatus(error) ?? 500;
    const where = `${req.method} ${req.originalUrl}`;

    if (status >= 500) {
      console.error(`unhandled error on ${where}:`, error);
      reportError(error, { route: where, userId: req.auth?.userId });
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`${status} on ${where}: ${detail}`);
    }

    // A route that already began streaming cannot have its status rewritten --
    // but it must still be terminated. Returning early here leaves the socket
    // open and the client waiting on a body that will never arrive, which is a
    // worse failure than a truncated one.
    if (res.headersSent) {
      res.end();
      return;
    }

    res.status(status).json({
      error:
        status >= 500
          ? "The request could not be completed."
          : error instanceof Error && error.message
            ? error.message
            : "The request was not valid.",
    });
  };
}
