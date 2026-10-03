import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../lib/db", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const runAgent = vi.fn();
vi.mock("../agent/loop", () => ({
  AGENT_ROUTE: "/api/agent/solve",
  runAgent: (...a: unknown[]) => runAgent(...a),
}));

const agentRouter = (await import("./agent")).default;

/** The router under test, without the server's global auth middleware. */
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/agent", agentRouter);
  return a;
}

const ANSWERED = {
  request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  status: "answered",
  answer: {
    status: "answered",
    steps: [],
    formulas: [],
    citations: [],
    quantities: [],
    final_answer: "92.6 min",
  },
  plan: null,
  trace: [],
  meta: {},
};

describe("POST /api/agent/solve", () => {
  it("returns the agent result", async () => {
    runAgent.mockResolvedValue(ANSWERED);
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "Period at 400 km?" });
    expect(res.status).toBe(200);
    expect(res.body.answer.final_answer).toBe("92.6 min");
  });

  it("includes the trace in the response, not just a debug log", async () => {
    runAgent.mockResolvedValue({ ...ANSWERED, trace: [{ type: "plan" }] });
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "x" });
    expect(res.body.trace).toHaveLength(1);
  });

  it("rejects a missing problem with 400 and field details", async () => {
    const res = await request(app()).post("/api/agent/solve").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request body");
    expect(JSON.stringify(res.body.details)).toContain("problem");
  });

  it("rejects an empty problem with 400", async () => {
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "" });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized problem with 400 before reaching the agent", async () => {
    runAgent.mockClear();
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "a".repeat(5000) });
    expect(res.status).toBe(400);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects a request_id that is not an RFC-4122 uuid", async () => {
    for (const id of ["not-a-uuid", "11111111-2222-3333-4444-555555555555"]) {
      const res = await request(app())
        .post("/api/agent/solve")
        .send({ problem: "x", request_id: id });
      expect(res.status, id).toBe(400);
    }
  });

  it("rejects a non-uuid request_id", async () => {
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "x", request_id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("passes a supplied request_id through to the agent", async () => {
    runAgent.mockResolvedValue(ANSWERED);
    await request(app())
      .post("/api/agent/solve")
      .send({
        problem: "x",
        request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      }),
    );
  });

  it("returns 200 for a refusal, because a refusal is a valid answer", async () => {
    runAgent.mockResolvedValue({ ...ANSWERED, status: "refused" });
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "legal advice please" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refused");
  });

  it("returns 200 for insufficient_data", async () => {
    runAgent.mockResolvedValue({ ...ANSWERED, status: "insufficient_data" });
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "x" });
    expect(res.status).toBe(200);
  });

  it("maps a guardrail rejection to 400", async () => {
    runAgent.mockResolvedValue({ ...ANSWERED, status: "rejected" });
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 500 with a request id and no internals when the agent throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runAgent.mockRejectedValue(
      new Error("DATABASE_URL=postgres://secret@host/db"),
    );
    const res = await request(app())
      .post("/api/agent/solve")
      .send({ problem: "x" });
    expect(res.status).toBe(500);
    expect(res.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toContain("postgres://");
  });
});

describe("GET /api/agent/tools", () => {
  it("publishes the tool contract", async () => {
    const res = await request(app()).get("/api/agent/tools");
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: { name: string }) => t.name)).toEqual([
      "orbital_calculator",
      "iss_position",
      "apod",
      "neo_lookup",
    ]);
    for (const tool of res.body.tools) {
      expect(tool.timeout_ms).toBeGreaterThan(0);
      expect(tool.parameters).toBeTruthy();
    }
  });
});
