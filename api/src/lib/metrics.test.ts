/**
 * Metrics tests against real Postgres (PGlite).
 *
 * The percentile SQL and the per-request rollup are the parts that can be
 * quietly wrong, and both are SQL, so a mock would test nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectMetrics } from "./metrics";
import { renderText } from "../routes/metrics";
import { createTestDb, type TestDb } from "../rag/testdb";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

const REQ_A = "aaaaaaaa-1111-4111-8111-111111111111";
const REQ_B = "bbbbbbbb-2222-4222-8222-222222222222";

async function trace(
  requestId: string,
  route: string,
  latency: number,
  opts: {
    outcome?: string;
    tokensIn?: number;
    tokensOut?: number;
    ageHours?: number;
  } = {},
) {
  await db.query(
    `INSERT INTO public.agent_traces
       (request_id, route, model, prompt_version, tokens_in, tokens_out, latency_ms, outcome, created_at)
     VALUES ($1,$2,'m','v',$3,$4,$5,$6, now() - ($7 || ' hours')::interval)`,
    [
      requestId,
      route,
      opts.tokensIn ?? 100,
      opts.tokensOut ?? 50,
      latency,
      opts.outcome ?? "ok",
      String(opts.ageHours ?? 0),
    ],
  );
}

async function toolCall(
  tool: string,
  latency: number,
  opts: {
    outcome?: string;
    attempts?: number;
    cacheHit?: boolean | null;
    ageHours?: number;
  } = {},
) {
  await db.query(
    `INSERT INTO public.agent_tool_calls
       (request_id, tool, iteration, outcome, attempts, latency_ms, cache_hit, created_at)
     VALUES ($1,$2,1,$3,$4,$5,$6, now() - ($7 || ' hours')::interval)`,
    [
      REQ_A,
      tool,
      opts.outcome ?? "ok",
      opts.attempts ?? 1,
      latency,
      opts.cacheHit === undefined ? null : opts.cacheHit,
      String(opts.ageHours ?? 0),
    ],
  );
}

describe("collectMetrics", () => {
  it("returns empty structures when there is no data", async () => {
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.routes).toEqual([]);
    expect(snapshot.tools).toEqual([]);
    expect(snapshot.requests.count).toBe(0);
    expect(snapshot.requests.p50_ms).toBeNull();
  });

  it("computes per-route percentiles", async () => {
    for (const latency of [100, 200, 300, 400, 1000]) {
      await trace(REQ_A, "/api/agent/solve#plan", latency);
    }
    const snapshot = await collectMetrics(db, 24);
    const route = snapshot.routes[0];
    expect(route.calls).toBe(5);
    expect(route.p50_ms).toBe(300);
    expect(route.p95_ms).toBe(1000);
    expect(route.max_ms).toBe(1000);
  });

  it("separates the three model call sites", async () => {
    await trace(REQ_A, "/api/agent/solve#plan", 100);
    await trace(REQ_A, "/api/agent/solve#tools", 200);
    await trace(REQ_A, "/api/agent/solve#synthesis", 300);
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.routes.map((r) => r.route).sort()).toEqual([
      "/api/agent/solve#plan",
      "/api/agent/solve#synthesis",
      "/api/agent/solve#tools",
    ]);
  });

  it("sums a request's model calls into one end-to-end latency", async () => {
    // The thing a user experiences is the sum, not any single call.
    await trace(REQ_A, "#plan", 1000);
    await trace(REQ_A, "#tools", 2000);
    await trace(REQ_A, "#synthesis", 3000);
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.requests.count).toBe(1);
    expect(snapshot.requests.p50_ms).toBe(6000);
  });

  it("computes request percentiles across requests, not calls", async () => {
    await trace(REQ_A, "#plan", 1000);
    await trace(REQ_A, "#synthesis", 1000);
    await trace(REQ_B, "#plan", 5000);
    await trace(REQ_B, "#synthesis", 5000);
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.requests.count).toBe(2);
    expect(snapshot.requests.max_ms).toBe(10_000);
  });

  it("counts errors and reports an error rate", async () => {
    await trace(REQ_A, "#plan", 100);
    await trace(REQ_A, "#plan", 100, { outcome: "error" });
    await trace(REQ_A, "#plan", 100, { outcome: "timeout" });
    const route = (await collectMetrics(db, 24)).routes[0];
    expect(route.errors).toBe(2);
    expect(route.error_rate).toBeCloseTo(2 / 3, 3);
  });

  it("counts a refusal as a request outcome, not an error", async () => {
    await trace(REQ_A, "#plan", 100, { outcome: "refused" });
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.requests.refused).toBe(1);
    expect(snapshot.requests.errored).toBe(0);
  });

  it("sums tokens per route and per request", async () => {
    await trace(REQ_A, "#plan", 100, { tokensIn: 400, tokensOut: 90 });
    await trace(REQ_A, "#synthesis", 100, { tokensIn: 1600, tokensOut: 210 });
    const snapshot = await collectMetrics(db, 24);
    expect(snapshot.requests.tokens_in).toBe(2000);
    expect(snapshot.requests.tokens_out).toBe(300);
  });

  it("reports cost as null when no price is configured", async () => {
    await trace(REQ_A, "#plan", 100);
    expect((await collectMetrics(db, 24)).requests.cost_usd).toBeNull();
  });

  it("respects the time window", async () => {
    await trace(REQ_A, "#plan", 100, { ageHours: 48 });
    await trace(REQ_B, "#plan", 100, { ageHours: 1 });
    expect((await collectMetrics(db, 24)).requests.count).toBe(1);
    expect((await collectMetrics(db, 72)).requests.count).toBe(2);
  });

  it("computes per-tool failure rate and mean attempts", async () => {
    await toolCall("orbital_calculator", 30);
    await toolCall("orbital_calculator", 40);
    await toolCall("orbital_calculator", 50, { outcome: "error", attempts: 3 });
    const tool = (await collectMetrics(db, 24)).tools[0];
    expect(tool.calls).toBe(3);
    expect(tool.failures).toBe(1);
    expect(tool.failure_rate).toBeCloseTo(1 / 3, 3);
    expect(tool.mean_attempts).toBeCloseTo(5 / 3, 2);
  });

  it("reports a cache hit rate only for tools that cache", async () => {
    // The physics engine has no cache; a 0% hit rate would be a false signal.
    await toolCall("orbital_calculator", 30, { cacheHit: null });
    await toolCall("apod", 500, { cacheHit: true });
    await toolCall("apod", 900, { cacheHit: false });
    const snapshot = await collectMetrics(db, 24);
    const physics = snapshot.tools.find(
      (t) => t.tool === "orbital_calculator",
    )!;
    const apod = snapshot.tools.find((t) => t.tool === "apod")!;
    expect(physics.cache_hit_rate).toBeNull();
    expect(apod.cache_hit_rate).toBeCloseTo(0.5, 3);
  });

  it("orders tools by call volume", async () => {
    await toolCall("apod", 100);
    for (let i = 0; i < 3; i++) await toolCall("orbital_calculator", 20);
    expect((await collectMetrics(db, 24)).tools[0].tool).toBe(
      "orbital_calculator",
    );
  });

  it("degrades with a reason rather than throwing when the store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error('relation "public.agent_traces" does not exist');
      },
    };
    const snapshot = await collectMetrics(broken, 24);
    expect(snapshot.degraded).toContain("agent_traces");
    expect(snapshot.routes).toEqual([]);
  });
});

describe("renderText", () => {
  it("renders latencies in seconds with the window and cost note", async () => {
    await trace(REQ_A, "/api/agent/solve#plan", 12_943);
    await toolCall("orbital_calculator", 36);
    const text = renderText(await collectMetrics(db, 24));
    expect(text).toContain("last 24h");
    expect(text).toContain("12.94s");
    expect(text).toContain("orbital_calculator");
    expect(text).toContain("GEMINI_INPUT_USD_PER_MTOK");
  });

  it("shows a dash rather than a zero when there is no data", async () => {
    expect(renderText(await collectMetrics(db, 24))).toContain("–");
  });

  it("surfaces a degraded collection at the top", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error("boom");
      },
    };
    expect(renderText(await collectMetrics(broken, 24))).toContain("DEGRADED");
  });
});
