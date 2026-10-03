/**
 * Sentry wiring for the API.
 *
 * DECISION (ADR-008): initialised from `SENTRY_DSN` and **inert when that is
 * unset**, so development and CI need no account, no network egress and no
 * configuration. A hard dependency on an external error reporter would mean the
 * server could not start without one, which is the wrong trade for a service
 * whose job is to answer physics questions.
 *
 * DECISION: data collection is switched off at the SDK level AND stripped again
 * in `beforeSend`. Student problem statements and paper questions are the user's
 * words, and shipping them to a third party to debug a stack trace is not a
 * trade this project makes — the same reason `agent_traces` records token counts
 * but not prompt text.
 *
 * Belt and braces on purpose: the `dataCollection` flags are configuration a
 * future change could flip, while the scrubber is code with a test next to it.
 *
 * Sentry must be imported and initialised before the modules it instruments, so
 * `server.ts` imports this first.
 */
import * as Sentry from "@sentry/node";

export const SENTRY_ENABLED: boolean = Boolean(process.env.SENTRY_DSN?.trim());

/** Header names that may carry a credential and must never be sent. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "idempotency-key",
  "x-api-key",
]);

export function initObservability(): void {
  if (!SENTRY_ENABLED) {
    console.info("SENTRY_DSN is not set; error reporting is disabled.");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.GIT_SHA,
    // Errors are the point. Traces are sampled low because the expensive spans
    // here are LLM calls already recorded in agent_traces with exact tokens and
    // latency — paying a second vendor to re-measure them would be duplication.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),

    // Sentry v11's explicit controls. Every category that could carry a
    // student's words or a credential is off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      // Prompts and completions. The whole point of the agent's own tracing is
      // that token counts live in agent_traces and prompt text lives nowhere.
      genAI: { inputs: false, outputs: false },
    },

    beforeSend(event) {
      // Drop anything that could carry a student's words or a credential.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) {
          for (const name of Object.keys(event.request.headers)) {
            if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
              delete event.request.headers[name];
            }
          }
        }
      }
      delete event.user;
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // HTTP breadcrumbs carry full URLs, and ours have API keys in the query
      // string (NASA). Keep the fact of the request, drop its details.
      if (breadcrumb.category === "http" && breadcrumb.data) {
        delete breadcrumb.data.url;
      }
      return breadcrumb;
    },
  });
}

/**
 * Report an error with a little structured context.
 *
 * `requestId` ties a Sentry event to the `agent_traces` rows for the same
 * request, which is where the token counts and tool timings live.
 */
export function reportError(
  error: unknown,
  context: { route?: string; requestId?: string; userId?: string } = {},
): void {
  if (!SENTRY_ENABLED) return;
  Sentry.withScope((scope) => {
    if (context.route) scope.setTag("route", context.route);
    if (context.requestId) scope.setTag("request_id", context.requestId);
    // The id only — never the email, which is PII we have no need to export.
    if (context.userId) scope.setTag("user_id", context.userId);
    Sentry.captureException(
      error instanceof Error ? error : new Error(String(error)),
    );
  });
}

/** Express error-handling middleware. Registered after all routes. */
export function sentryErrorHandler(): ReturnType<
  typeof Sentry.expressErrorHandler
> | null {
  return SENTRY_ENABLED ? Sentry.expressErrorHandler() : null;
}

export { Sentry };
