/**
 * Observability writes for the agent.
 *
 * `agent_traces` keeps its documented contract from migration 001 — one row per
 * LLM call, several rows sharing a request_id for one agent request. Tool calls
 * go to `agent_tool_calls` (migration 002) rather than being squeezed into a
 * table whose columns describe model invocations.
 *
 * Both writers are best-effort: a trace write must never fail a user request.
 * Same posture as `upsertUser` in the auth middleware.
 */
import { pool } from "./db";

export type TraceOutcome = "ok" | "error" | "refused" | "timeout";

export interface LlmTraceRow {
  requestId: string;
  userId: string | null;
  route: string;
  model: string;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  outcome: TraceOutcome;
}

export interface ToolTraceRow {
  requestId: string;
  userId: string | null;
  tool: string;
  iteration: number;
  args: unknown;
  outcome: TraceOutcome;
  errorKind: string | null;
  attempts: number;
  latencyMs: number;
  cacheHit: boolean | null;
}

let traceWarned = false;

function warnOnce(table: string, err: unknown): void {
  if (traceWarned) return;
  traceWarned = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `${table} write failed; tracing disabled for this process: ${message}`,
  );
}

export async function recordLlmCall(row: LlmTraceRow): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.agent_traces
         (request_id, user_id, route, model, prompt_version,
          tokens_in, tokens_out, cost_usd, latency_ms, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.requestId,
        row.userId,
        row.route,
        row.model,
        row.promptVersion,
        row.tokensIn,
        row.tokensOut,
        row.costUsd,
        row.latencyMs,
        row.outcome,
      ],
    );
  } catch (err) {
    warnOnce("agent_traces", err);
  }
}

export async function recordToolCall(row: ToolTraceRow): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.agent_tool_calls
         (request_id, user_id, tool, iteration, args, outcome, error_kind, attempts, latency_ms, cache_hit)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        row.requestId,
        row.userId,
        row.tool,
        row.iteration,
        JSON.stringify(row.args ?? null),
        row.outcome,
        row.errorKind,
        row.attempts,
        row.latencyMs,
        row.cacheHit,
      ],
    );
  } catch (err) {
    warnOnce("agent_tool_calls", err);
  }
}

/**
 * Token cost in USD, or null when no rate is configured.
 *
 * DECISION: the rate lives in the environment rather than a hard-coded price
 * table. Model prices change and a stale constant silently produces fabricated
 * cost figures; a null is honest. Tokens themselves are always recorded exactly.
 */
export function estimateCostUsd(
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const inRate = Number(process.env.GEMINI_INPUT_USD_PER_MTOK);
  const outRate = Number(process.env.GEMINI_OUTPUT_USD_PER_MTOK);
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate)) return null;
  const cost =
    ((tokensIn ?? 0) / 1e6) * inRate + ((tokensOut ?? 0) / 1e6) * outRate;
  return Number(cost.toFixed(6));
}
