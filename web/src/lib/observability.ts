/**
 * Sentry wiring for the SPA.
 *
 * Inert unless `VITE_SENTRY_DSN` is set at build time, so local development and
 * CI need no account and no network egress.
 *
 * Privacy posture matches the API (ADR-008): the user's words never leave the
 * browser for error-reporting purposes. A student's problem statement and paper
 * questions are the content of the product, not debugging telemetry. Session
 * Replay and `sendDefaultPii` are both off, and `beforeSend` strips the breadcrumb
 * trail of what they typed.
 */
import * as Sentry from "@sentry/react";

const DSN: string = (import.meta.env.VITE_SENTRY_DSN ?? "").trim();

export const SENTRY_ENABLED: boolean = DSN.length > 0;

export function initObservability(): void {
  if (!SENTRY_ENABLED) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA as string | undefined,
    // Errors only. No Session Replay: it records the DOM, which here contains
    // the student's questions and the paper text they uploaded.
    integrations: [],
    tracesSampleRate: 0,

    beforeBreadcrumb(breadcrumb) {
      // `ui.input` breadcrumbs capture typed values; `console` ones often carry
      // response bodies. Neither is worth a student's text leaving the browser.
      if (
        breadcrumb.category === "ui.input" ||
        breadcrumb.category === "console"
      ) {
        return null;
      }
      return breadcrumb;
    },

    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
      }
      return event;
    },
  });
}

/** Report a handled error that the UI recovered from. */
export function reportError(
  error: unknown,
  context: Record<string, string> = {},
): void {
  if (!SENTRY_ENABLED) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context))
      scope.setTag(key, value);
    Sentry.captureException(
      error instanceof Error ? error : new Error(String(error)),
    );
  });
}

export { Sentry };
