/**
 * Latency, cost and error metrics read from the tracing tables.
 *
 * DECISION (ADR-008): compute percentiles in Postgres with
 * `percentile_disc`, not in Node. The rows already live in the database, the
 * aggregation is one indexed scan, and pulling a day of traces over the wire to
 * sort them in JavaScript would move megabytes to compute a handful of numbers.
 *
 * Everything here is derived from `agent_traces` (one row per LLM call) and
 * `agent_tool_calls` (one row per tool call), which Week 4 already writes. No
 * new instrumentation was added for this — if the tables cannot answer a
 * question, that is a gap in the tracing, and the fix belongs there.
 */
import { pool } from "./db";

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface LatencyPercentiles {
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
}

export interface RouteMetrics extends LatencyPercentiles {
  route: string;
  calls: number;
  errors: number;
  error_rate: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
}

export interface ToolMetrics extends LatencyPercentiles {
  tool: string;
  calls: number;
  failures: number;
  failure_rate: number;
  /** Null for tools with no cache (the physics engine). */
  cache_hit_rate: number | null;
  /** Mean attempts; above 1 means the retry path is firing. */
  mean_attempts: number;
}

export interface MetricsSnapshot {
  window_hours: number;
  generated_at: string;
  /** One row per LLM call site: #plan, #tools, #synthesis. */
  routes: RouteMetrics[];
  tools: ToolMetrics[];
  /** End-to-end per agent request, summed across its LLM calls. */
  requests: LatencyPercentiles & {
    count: number;
    refused: number;
    errored: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
  };
  /** Null when no token price is configured; never a guess. */
  cost_note: string;
  degraded?: string;
}

const PERCENTILES = `
  percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS p50_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_ms,
  percentile_disc(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99_ms,
  max(latency_ms)::int AS max_ms`;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function maybeNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function collectMetrics(
  db: Queryable = pool,
  windowHours = 24,
): Promise<MetricsSnapshot> {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const base: MetricsSnapshot = {
    window_hours: windowHours,
    generated_at: new Date().toISOString(),
    routes: [],
    tools: [],
    requests: {
      count: 0,
      refused: 0,
      errored: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: null,
      p50_ms: null,
      p95_ms: null,
      p99_ms: null,
      max_ms: null,
    },
    cost_note:
      "cost_usd is null unless GEMINI_INPUT_USD_PER_MTOK and GEMINI_OUTPUT_USD_PER_MTOK are set. Token counts are always exact.",
  };

  try {
    const routes = await db.query<Record<string, unknown>>(
      `SELECT route,
              count(*)::int AS calls,
              count(*) FILTER (WHERE outcome IN ('error', 'timeout'))::int AS errors,
              coalesce(sum(tokens_in), 0)::int AS tokens_in,
              coalesce(sum(tokens_out), 0)::int AS tokens_out,
              sum(cost_usd) AS cost_usd,
              ${PERCENTILES}
         FROM public.agent_traces
        WHERE created_at >= $1
        GROUP BY route
        ORDER BY calls DESC`,
      [since],
    );

    const tools = await db.query<Record<string, unknown>>(
      `SELECT tool,
              count(*)::int AS calls,
              count(*) FILTER (WHERE outcome <> 'ok')::int AS failures,
              avg(attempts)::numeric(10,2) AS mean_attempts,
              -- Null, not 0, when the tool has no cache: a physics call that
              -- never caches must not look like a 0% hit rate.
              CASE WHEN count(cache_hit) = 0 THEN NULL
                   ELSE (count(*) FILTER (WHERE cache_hit))::numeric / count(cache_hit)
              END AS cache_hit_rate,
              ${PERCENTILES}
         FROM public.agent_tool_calls
        WHERE created_at >= $1
        GROUP BY tool
        ORDER BY calls DESC`,
      [since],
    );

    // One agent request is several LLM calls sharing a request_id, so end-to-end
    // latency is their sum, not any single row's latency.
    const requests = await db.query<Record<string, unknown>>(
      `WITH per_request AS (
         SELECT request_id,
                sum(latency_ms)::int AS latency_ms,
                coalesce(sum(tokens_in), 0)::int AS tokens_in,
                coalesce(sum(tokens_out), 0)::int AS tokens_out,
                sum(cost_usd) AS cost_usd,
                bool_or(outcome = 'refused') AS refused,
                bool_or(outcome IN ('error', 'timeout')) AS errored
           FROM public.agent_traces
          WHERE created_at >= $1
          GROUP BY request_id
       )
       SELECT count(*)::int AS count,
              count(*) FILTER (WHERE refused)::int AS refused,
              count(*) FILTER (WHERE errored)::int AS errored,
              coalesce(sum(tokens_in), 0)::int AS tokens_in,
              coalesce(sum(tokens_out), 0)::int AS tokens_out,
              sum(cost_usd) AS cost_usd,
              ${PERCENTILES}
         FROM per_request`,
      [since],
    );

    const r = requests.rows[0] ?? {};
    return {
      ...base,
      routes: routes.rows.map((row) => ({
        route: String(row.route),
        calls: num(row.calls),
        errors: num(row.errors),
        error_rate: num(row.calls)
          ? Number((num(row.errors) / num(row.calls)).toFixed(4))
          : 0,
        tokens_in: num(row.tokens_in),
        tokens_out: num(row.tokens_out),
        cost_usd: maybeNum(row.cost_usd),
        p50_ms: maybeNum(row.p50_ms),
        p95_ms: maybeNum(row.p95_ms),
        p99_ms: maybeNum(row.p99_ms),
        max_ms: maybeNum(row.max_ms),
      })),
      tools: tools.rows.map((row) => ({
        tool: String(row.tool),
        calls: num(row.calls),
        failures: num(row.failures),
        failure_rate: num(row.calls)
          ? Number((num(row.failures) / num(row.calls)).toFixed(4))
          : 0,
        cache_hit_rate:
          row.cache_hit_rate === null || row.cache_hit_rate === undefined
            ? null
            : Number(Number(row.cache_hit_rate).toFixed(4)),
        mean_attempts: Number(num(row.mean_attempts).toFixed(2)),
        p50_ms: maybeNum(row.p50_ms),
        p95_ms: maybeNum(row.p95_ms),
        p99_ms: maybeNum(row.p99_ms),
        max_ms: maybeNum(row.max_ms),
      })),
      requests: {
        count: num(r.count),
        refused: num(r.refused),
        errored: num(r.errored),
        tokens_in: num(r.tokens_in),
        tokens_out: num(r.tokens_out),
        cost_usd: maybeNum(r.cost_usd),
        p50_ms: maybeNum(r.p50_ms),
        p95_ms: maybeNum(r.p95_ms),
        p99_ms: maybeNum(r.p99_ms),
        max_ms: maybeNum(r.max_ms),
      },
    };
  } catch (err) {
    // A metrics page that 500s when the database is slow is worse than one that
    // says so: the moment you most want metrics is when something is wrong.
    const message = err instanceof Error ? err.message : String(err);
    console.error("metrics collection failed:", message);
    return { ...base, degraded: message };
  }
}
