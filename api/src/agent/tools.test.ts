import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../lib/db", () => ({
  pool: { query: (...a: unknown[]) => query(...a) },
}));

const postToScience = vi.fn();
vi.mock("../lib/scienceClient", () => ({
  postToScience: (...a: unknown[]) => postToScience(...a),
}));

const { clearMemoryCache } = await import("../lib/cache");
const { TOOL_NAMES, functionDeclarations, runTool } = await import("./tools");

const PERIOD_RESULT = {
  period_s: 5553.6,
  period_min: 92.56,
  semi_major_axis_km: 6778.137,
  formula: "T = 2π·√(a³/μ)",
};

beforeEach(() => {
  clearMemoryCache();
  postToScience.mockReset();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("exposes exactly the four Week-4 tools", () => {
    expect(TOOL_NAMES).toEqual([
      "orbital_calculator",
      "iss_position",
      "apod",
      "neo_lookup",
    ]);
  });

  it("declares every tool to the model with a name and parameters", () => {
    for (const d of functionDeclarations()) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.parameters?.type).toBeTruthy();
    }
  });

  it("states units in every numeric tool's declaration (unit drift is the main failure mode)", () => {
    const numericTools = ["orbital_calculator", "iss_position", "neo_lookup"];
    for (const d of functionDeclarations().filter((t) =>
      numericTools.includes(t.name ?? ""),
    )) {
      expect(`${d.description}`.toLowerCase()).toMatch(
        /km|metre|meter|degree|km\/s/,
      );
    }
  });
});

describe("runTool argument validation", () => {
  it("rejects an unknown tool and lists the real ones", async () => {
    const out = await runTool("rm_rf", {});
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("unknown_tool");
    expect(out.error).toContain("orbital_calculator");
    expect(postToScience).not.toHaveBeenCalled();
  });

  it("rejects a missing required parameter naming the parameter", async () => {
    const out = await runTool("orbital_calculator", { operation: "period" });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("validation");
    expect(out.error).toContain("altitude_km");
    expect(postToScience).not.toHaveBeenCalled();
  });

  it("rejects an unsupported operation", async () => {
    const out = await runTool("orbital_calculator", {
      operation: "warp_drive",
      altitude_km: 400,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("validation");
  });

  it("rejects a physically impossible negative altitude before dispatch", async () => {
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: -400,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("validation");
    expect(postToScience).not.toHaveBeenCalled();
  });

  it("rejects NaN and Infinity", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = await runTool("orbital_calculator", {
        operation: "period",
        altitude_km: bad,
      });
      expect(out.ok).toBe(false);
    }
  });

  it("requires both parameters for vis_viva", async () => {
    const out = await runTool("orbital_calculator", {
      operation: "vis_viva",
      altitude_km: 400,
    });
    expect(out.error).toContain("semi_major_axis_km");
  });

  it("requires a ground site for next_passes", async () => {
    const out = await runTool("iss_position", { mode: "next_passes" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/place|lat_deg/);
  });

  it("accepts next_passes with coordinates only", async () => {
    postToScience.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: { passes: [] },
    });
    const out = await runTool("iss_position", {
      mode: "next_passes",
      lat_deg: 43.6,
      lon_deg: -79.4,
    });
    expect(out.ok).toBe(true);
  });

  it("rejects out-of-range coordinates", async () => {
    const out = await runTool("iss_position", {
      mode: "next_passes",
      lat_deg: 100,
      lon_deg: 0,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("validation");
  });

  it("rejects passing both an asteroid id and a date range", async () => {
    const out = await runTool("neo_lookup", {
      asteroid_id: "123",
      start_date: "2026-09-30",
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not both");
  });

  it("carries coercion notes through to the outcome", async () => {
    postToScience.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: PERIOD_RESULT,
    });
    const out = await runTool(
      "orbital_calculator",
      { operation: "period", altitude_km: 400 },
      ['altitude_km: "400 km" -> 400'],
    );
    expect(out.ok).toBe(true);
    expect(out.coercions).toHaveLength(1);
  });
});

describe("runTool execution", () => {
  it("passes validated arguments to the right science path", async () => {
    postToScience.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: PERIOD_RESULT,
    });
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: 400,
    });
    expect(out.ok).toBe(true);
    // The engine's own fields pass through untouched, plus a citable source.
    expect(out.result).toMatchObject(PERIOD_RESULT);
    expect((out.result as { source: string }).source).toContain(
      "orbital.period",
    );
    expect(postToScience).toHaveBeenCalledWith(
      expect.any(String),
      "/calculate/period",
      { altitude_km: 400 },
    );
  });

  it.each([
    [
      "velocity",
      "/calculate/velocity",
      { operation: "velocity", altitude_km: 400 },
    ],
    [
      "escape_velocity",
      "/calculate/escape-velocity",
      { operation: "escape_velocity", altitude_km: 0 },
    ],
    [
      "energy",
      "/calculate/energy",
      { operation: "energy", semi_major_axis_km: 6778 },
    ],
    [
      "hohmann",
      "/calculate/hohmann",
      { operation: "hohmann", alt1_km: 400, alt2_km: 35786 },
    ],
  ])("routes %s to %s", async (_op, path, args) => {
    postToScience.mockResolvedValue({ kind: "ok", status: 200, body: {} });
    await runTool("orbital_calculator", args);
    expect(postToScience).toHaveBeenCalledWith(
      expect.any(String),
      path,
      expect.any(Object),
    );
  });

  it("treats a science 422 as an input error and does not retry it", async () => {
    postToScience.mockResolvedValue({
      kind: "ok",
      status: 422,
      body: { detail: "altitude_km must be non-negative" },
    });
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: 400,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("input");
    expect(out.attempts).toBe(1);
  });

  it("retries a science 500 and then succeeds", async () => {
    postToScience
      .mockResolvedValueOnce({ kind: "ok", status: 500, body: {} })
      .mockResolvedValueOnce({ kind: "ok", status: 200, body: PERIOD_RESULT });
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: 400,
    });
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
  });

  it("retries a network failure up to the tool's budget then reports it", async () => {
    postToScience.mockResolvedValue({
      kind: "network",
      message: "ECONNREFUSED",
    });
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: 400,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("transient");
    expect(out.attempts).toBe(3); // 1 + 2 retries
    expect(out.error).toContain("unreachable");
  });

  it("times out an executor that never settles and ignores its abort signal", async () => {
    // iss_position allows 25 s and one retry. A hung executor must not hang the
    // agent, even though it never observes the signal.
    vi.useFakeTimers();
    postToScience.mockImplementation(() => new Promise(() => {}));
    const pending = runTool("iss_position", {
      mode: "next_passes",
      place: "Toronto",
    });
    await vi.advanceTimersByTimeAsync(26_000); // first attempt times out
    await vi.advanceTimersByTimeAsync(5_000); // backoff sleep
    await vi.advanceTimersByTimeAsync(26_000); // retry times out
    const out = await pending;
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("timeout");
    expect(out.error).toContain("timed out after 25000 ms");
    expect(out.attempts).toBe(2);
  });

  it("maps a science 503 (no TLE) to a transient failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response),
    );
    const out = await runTool("iss_position", { mode: "current_position" });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe("transient");
  });

  it("returns the ISS position payload for current_position", async () => {
    const body = {
      latitude_deg: 1,
      longitude_deg: 2,
      altitude_km: 420,
      norad_id: 25544,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => body,
        } as Response),
    );
    const out = await runTool("iss_position", { mode: "current_position" });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual(body);
  });

  it("defaults next_passes parameters so the model need not supply them", async () => {
    postToScience.mockResolvedValue({ kind: "ok", status: 200, body: {} });
    await runTool("iss_position", { mode: "next_passes", place: "Toronto" });
    expect(postToScience).toHaveBeenCalledWith(
      expect.any(String),
      "/iss/passes",
      {
        place: "Toronto",
        days: 2,
        min_elevation_deg: 10,
        max_passes: 3,
      },
    );
  });

  it("reports how long a call took", async () => {
    postToScience.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: PERIOD_RESULT,
    });
    const out = await runTool("orbital_calculator", {
      operation: "period",
      altitude_km: 400,
    });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});
