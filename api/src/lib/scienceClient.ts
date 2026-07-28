const SCIENCE_TIMEOUT_MS = 10_000;

export interface ScienceResult {
  status: number;
  body: unknown;
}

export interface ScienceNetworkError {
  kind: "network";
  message: string;
}

export type ScienceCallOutcome =
  { kind: "ok"; status: number; body: unknown } | ScienceNetworkError;

/**
 * POST a JSON body to a path on the science service and return the parsed
 * response body along with its HTTP status. Callers pass the science status
 * through unchanged; only true network/timeout errors surface as `network`.
 */
export async function postToScience(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<ScienceCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCIENCE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
    }
    return { kind: "ok", status: res.status, body: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "network", message };
  } finally {
    clearTimeout(timer);
  }
}
