import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { collectMetrics, type MetricsSnapshot } from "../lib/metrics";

/**
 * Minimal admin metrics surface.
 *
 * DECISION (ADR-008): a page served from our own tracing tables, not a Grafana
 * Cloud integration. Grafana would need an exporter, a scrape target reachable
 * from outside, an account and a dashboard definition — infrastructure that
 * exists to display numbers this endpoint can compute in one SQL query. The
 * smallest thing that answers "what is p95 and what is it costing" wins at this
 * scale (project principle: simple + measurable + explainable).
 *
 * DECISION: gated by an explicit allow-list of user ids rather than a role
 * column. There is one operator. A `role` column plus an admin UI to manage it
 * would be a feature nobody asked for; an env var is honest about the scale.
 * Unset means the route is disabled entirely, so a misconfigured deploy fails
 * closed rather than exposing cost data.
 */
const ADMIN_IDS: Set<string> = new Set(
  (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const Query = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  format: z.enum(["json", "text"]).default("json"),
});

const router: Router = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (ADMIN_IDS.size === 0) {
    res.status(404).json({ error: "Not found." });
    return false;
  }
  const userId = req.auth?.userId;
  if (!userId || !ADMIN_IDS.has(userId)) {
    // 404 rather than 403: a non-admin should not learn the route exists.
    res.status(404).json({ error: "Not found." });
    return false;
  }
  return true;
}

/** GET /api/admin/metrics — latency percentiles, tokens, errors, cache hit rates. */
router.get("/metrics", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }

  const snapshot = await collectMetrics(undefined, parsed.data.hours);
  if (parsed.data.format === "text") {
    res.type("text/plain").send(renderText(snapshot));
    return;
  }
  res.json(snapshot);
});

/**
 * A plain-text rendering, so the numbers are readable from a terminal with curl
 * and pasteable into a doc without a JSON viewer.
 */
export function renderText(snapshot: MetricsSnapshot): string {
  const ms = (value: number | null): string =>
    value === null ? "–" : `${(value / 1000).toFixed(2)}s`;
  const lines: string[] = [
    `AstroAI metrics · last ${snapshot.window_hours}h · ${snapshot.generated_at}`,
    "=".repeat(72),
  ];
  if (snapshot.degraded) {
    lines.push(`DEGRADED: ${snapshot.degraded}`, "");
  }

  const r = snapshot.requests;
  lines.push(
    "Agent requests (end to end, summed across each request's model calls)",
    `  count ${r.count}   refused ${r.refused}   errored ${r.errored}`,
    `  p50 ${ms(r.p50_ms)}   p95 ${ms(r.p95_ms)}   p99 ${ms(r.p99_ms)}   max ${ms(r.max_ms)}`,
    `  tokens ${r.tokens_in} in / ${r.tokens_out} out   cost ${r.cost_usd === null ? "n/a" : `$${r.cost_usd.toFixed(4)}`}`,
    "",
    "Per model call site",
    `  ${"route".padEnd(28)} ${"calls".padStart(6)} ${"err".padStart(5)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"p99".padStart(8)}`,
  );
  for (const route of snapshot.routes) {
    lines.push(
      `  ${route.route.padEnd(28)} ${String(route.calls).padStart(6)} ${String(route.errors).padStart(5)} ` +
        `${ms(route.p50_ms).padStart(8)} ${ms(route.p95_ms).padStart(8)} ${ms(route.p99_ms).padStart(8)}`,
    );
  }

  lines.push(
    "",
    "Per tool",
    `  ${"tool".padEnd(22)} ${"calls".padStart(6)} ${"fail".padStart(5)} ${"att".padStart(5)} ${"cache".padStart(6)} ${"p50".padStart(8)} ${"p95".padStart(8)}`,
  );
  for (const tool of snapshot.tools) {
    const cache =
      tool.cache_hit_rate === null
        ? "n/a"
        : `${(tool.cache_hit_rate * 100).toFixed(0)}%`;
    lines.push(
      `  ${tool.tool.padEnd(22)} ${String(tool.calls).padStart(6)} ${String(tool.failures).padStart(5)} ` +
        `${tool.mean_attempts.toFixed(2).padStart(5)} ${cache.padStart(6)} ${ms(tool.p50_ms).padStart(8)} ${ms(tool.p95_ms).padStart(8)}`,
    );
  }

  lines.push("", snapshot.cost_note);
  return lines.join("\n");
}

export default router;
