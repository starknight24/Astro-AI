/**
 * NASA Open API wrappers: APOD (Astronomy Picture of the Day) and NeoWs
 * (Near-Earth Object Web Service).
 *
 * Every call is timed out, retried with backoff on transient failures, and
 * cached for an hour (ADR-005). The cache is not an optimisation nicety:
 * `NASA_API_KEY` defaults to NASA's shared `DEMO_KEY`, which is capped at 30
 * requests/hour/IP, and api.nasa.gov is measurably flaky (three consecutive
 * Week-4 probes of APOD returned timeout, 200, 500).
 *
 * Responses are reduced to the fields the agent actually cites. NeoWs feed
 * payloads are tens of kilobytes of unit conversions per object; sending that
 * to the model would waste tokens and invite the model to pick a unit at random.
 */
import { ONE_HOUR_MS, withCache } from "./cache";
import { withRetry } from "./retry";

const NASA_BASE = "https://api.nasa.gov";
const NASA_TIMEOUT_MS = 9000;
const NASA_RETRIES = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class NasaApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "NasaApiError";
  }
}

function apiKey(): string {
  // DEMO_KEY works without signup but is heavily rate limited; production sets
  // a real key. Documented in .env.example.
  return process.env.NASA_API_KEY?.trim() || "DEMO_KEY";
}

/** A 429/5xx/network failure is worth another attempt; a 4xx is our bug. */
function isRetryable(err: unknown): boolean {
  return err instanceof NasaApiError ? err.retryable : true;
}

async function nasaGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${NASA_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", apiKey());

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NASA_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          // Never echo the URL back: it carries the API key.
          throw new NasaApiError(
            `NASA ${path} responded ${res.status}`,
            res.status,
            retryable,
          );
        }
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof NasaApiError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof Error && err.name === "AbortError";
        throw new NasaApiError(
          isAbort
            ? `NASA ${path} timed out after ${NASA_TIMEOUT_MS} ms`
            : `NASA ${path} failed: ${message}`,
          null,
          true,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    {
      retries: NASA_RETRIES,
      shouldRetry: isRetryable,
      onRetry: (err, attempt, delay) =>
        console.warn(
          `NASA ${path} attempt ${attempt + 1} failed (${err instanceof Error ? err.message : err}); retrying in ${delay} ms`,
        ),
    },
  );
}

// ---------- APOD ----------

export interface ApodRaw {
  date: string;
  title: string;
  explanation: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  copyright?: string;
}

export interface Apod {
  date: string;
  title: string;
  explanation: string;
  media_type: string;
  url: string | null;
  hdurl: string | null;
  copyright: string | null;
  source: string;
}

export async function getApod(
  date?: string,
): Promise<{ data: Apod; cached: boolean }> {
  if (date !== undefined && !DATE_RE.test(date)) {
    throw new NasaApiError(
      `date must be YYYY-MM-DD, got '${date}'`,
      400,
      false,
    );
  }
  const key = `nasa:apod:${date ?? "today"}`;
  const { value, cached } = await withCache(key, ONE_HOUR_MS, async () => {
    const raw = await nasaGet<ApodRaw>("/planetary/apod", date ? { date } : {});
    const shaped: Apod = {
      date: raw.date,
      title: raw.title,
      explanation: raw.explanation,
      media_type: raw.media_type ?? "image",
      url: raw.url ?? null,
      hdurl: raw.hdurl ?? null,
      copyright: raw.copyright?.trim() ?? null,
      source: `NASA APOD, ${raw.date} (api.nasa.gov/planetary/apod)`,
    };
    return shaped;
  });
  return { data: value, cached };
}

// ---------- NeoWs ----------

interface NeoRaw {
  id: string;
  name: string;
  absolute_magnitude_h?: number;
  is_potentially_hazardous_asteroid: boolean;
  nasa_jpl_url?: string;
  estimated_diameter?: {
    meters?: {
      estimated_diameter_min?: number;
      estimated_diameter_max?: number;
    };
  };
  close_approach_data?: {
    close_approach_date: string;
    close_approach_date_full?: string;
    orbiting_body?: string;
    miss_distance?: { kilometers?: string; lunar?: string };
    relative_velocity?: { kilometers_per_second?: string };
  }[];
}

interface NeoFeedRaw {
  element_count: number;
  near_earth_objects: Record<string, NeoRaw[]>;
}

export interface NeoSummary {
  id: string;
  name: string;
  absolute_magnitude_h: number | null;
  is_potentially_hazardous: boolean;
  diameter_min_m: number | null;
  diameter_max_m: number | null;
  close_approach_date: string | null;
  close_approach_utc: string | null;
  miss_distance_km: number | null;
  miss_distance_lunar: number | null;
  relative_velocity_kms: number | null;
  orbiting_body: string | null;
  jpl_url: string | null;
}

export interface NeoFeed {
  start_date: string;
  end_date: string;
  element_count: number;
  hazardous_count: number;
  objects: NeoSummary[];
  closest: NeoSummary | null;
  source: string;
}

function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number | null, dp: number): number | null {
  return v === null ? null : Number(v.toFixed(dp));
}

function summarizeNeo(raw: NeoRaw): NeoSummary {
  const approach = raw.close_approach_data?.[0];
  return {
    id: raw.id,
    name: raw.name,
    absolute_magnitude_h: num(raw.absolute_magnitude_h),
    is_potentially_hazardous: Boolean(raw.is_potentially_hazardous_asteroid),
    diameter_min_m: round(
      num(raw.estimated_diameter?.meters?.estimated_diameter_min),
      1,
    ),
    diameter_max_m: round(
      num(raw.estimated_diameter?.meters?.estimated_diameter_max),
      1,
    ),
    close_approach_date: approach?.close_approach_date ?? null,
    close_approach_utc: approach?.close_approach_date_full ?? null,
    miss_distance_km: round(num(approach?.miss_distance?.kilometers), 0),
    miss_distance_lunar: round(num(approach?.miss_distance?.lunar), 2),
    relative_velocity_kms: round(
      num(approach?.relative_velocity?.kilometers_per_second),
      3,
    ),
    orbiting_body: approach?.orbiting_body ?? null,
    jpl_url: raw.nasa_jpl_url ?? null,
  };
}

export interface NeoFeedQuery {
  start_date?: string;
  end_date?: string;
  hazardous_only?: boolean;
  limit?: number;
}

/** NeoWs caps a feed query at a 7-day span. */
const NEO_MAX_SPAN_DAYS = 7;
const NEO_DEFAULT_LIMIT = 10;

export async function getNeoFeed(
  query: NeoFeedQuery = {},
): Promise<{ data: NeoFeed; cached: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const start = query.start_date ?? today;
  const end = query.end_date ?? start;
  for (const [label, value] of [
    ["start_date", start],
    ["end_date", end],
  ] as const) {
    if (!DATE_RE.test(value)) {
      throw new NasaApiError(
        `${label} must be YYYY-MM-DD, got '${value}'`,
        400,
        false,
      );
    }
  }
  const spanDays = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (Number.isNaN(spanDays)) {
    throw new NasaApiError(
      "start_date/end_date are not valid dates",
      400,
      false,
    );
  }
  if (spanDays < 0) {
    throw new NasaApiError("end_date must not precede start_date", 400, false);
  }
  if (spanDays > NEO_MAX_SPAN_DAYS) {
    throw new NasaApiError(
      `NeoWs allows at most a ${NEO_MAX_SPAN_DAYS}-day range; got ${spanDays} days`,
      400,
      false,
    );
  }

  const limit = Math.min(Math.max(query.limit ?? NEO_DEFAULT_LIMIT, 1), 25);
  const key = `nasa:neo:feed:${start}:${end}`;
  const { value: raw, cached } = await withCache(key, ONE_HOUR_MS, () =>
    nasaGet<NeoFeedRaw>("/neo/rest/v1/feed", {
      start_date: start,
      end_date: end,
    }),
  );

  const all = Object.values(raw.near_earth_objects ?? {})
    .flat()
    .map(summarizeNeo)
    .sort(
      (a, b) =>
        (a.miss_distance_km ?? Infinity) - (b.miss_distance_km ?? Infinity),
    );
  const filtered = query.hazardous_only
    ? all.filter((o) => o.is_potentially_hazardous)
    : all;

  return {
    data: {
      start_date: start,
      end_date: end,
      element_count: raw.element_count ?? all.length,
      hazardous_count: all.filter((o) => o.is_potentially_hazardous).length,
      objects: filtered.slice(0, limit),
      closest: filtered[0] ?? null,
      source: `NASA NeoWs feed ${start}..${end} (api.nasa.gov/neo/rest/v1/feed)`,
    },
    cached,
  };
}

export async function getNeoById(
  asteroidId: string,
): Promise<{ data: NeoSummary & { source: string }; cached: boolean }> {
  if (!/^\d{1,12}$/.test(asteroidId)) {
    throw new NasaApiError(
      `asteroid_id must be a NeoWs numeric SPK-ID, got '${asteroidId}'`,
      400,
      false,
    );
  }
  const key = `nasa:neo:id:${asteroidId}`;
  const { value, cached } = await withCache(key, ONE_HOUR_MS, async () => {
    const raw = await nasaGet<NeoRaw>(`/neo/rest/v1/neo/${asteroidId}`, {});
    return {
      ...summarizeNeo(raw),
      source: `NASA NeoWs object ${asteroidId} (api.nasa.gov/neo/rest/v1/neo)`,
    };
  });
  return { data: value, cached };
}
