import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { clientErrorStatus, errorHandler } from "./errorHandler";

/** An app whose single route throws whatever the test supplies. */
function app(thrown: unknown, reportError = vi.fn()) {
  const a = express();
  a.use(express.json());
  a.post("/boom", () => {
    throw thrown;
  });
  a.use(errorHandler({ reportError }));
  return { a, reportError };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("clientErrorStatus", () => {
  it("trusts a 4xx on either property name", () => {
    expect(clientErrorStatus({ status: 400 })).toBe(400);
    expect(clientErrorStatus({ statusCode: 413 })).toBe(413);
    expect(clientErrorStatus({ status: 499 })).toBe(499);
  });

  it("refuses anything that is not a 4xx", () => {
    // A dependency's 5xx must not be echoed back as its own status, and a 3xx
    // or a nonsense value must not become the response code.
    expect(clientErrorStatus({ status: 500 })).toBeNull();
    expect(clientErrorStatus({ status: 302 })).toBeNull();
    expect(clientErrorStatus({ status: 4000 })).toBeNull();
    expect(clientErrorStatus({ status: 404.5 })).toBeNull();
    expect(clientErrorStatus({ status: "400" })).toBeNull();
    expect(clientErrorStatus(new Error("plain"))).toBeNull();
    expect(clientErrorStatus(null)).toBeNull();
    expect(clientErrorStatus(undefined)).toBeNull();
  });
});

describe("errorHandler", () => {
  it("returns 500 and a generic message for an ordinary throw", async () => {
    const { a, reportError } = app(new Error("pool exhausted"));
    const res = await request(a).post("/boom").send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "The request could not be completed." });
    // The internal reason must not reach the caller.
    expect(JSON.stringify(res.body)).not.toContain("pool exhausted");
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("passes through a 4xx the error carries, and does not report it", async () => {
    const err = Object.assign(new Error("Unexpected end of JSON input"), {
      status: 400,
    });
    const { a, reportError } = app(err);
    const res = await request(a).post("/boom").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unexpected end of JSON input");
    // A client mistake is not a server fault; reporting it would fill Sentry
    // with noise and spend the 5xx budget the load tests threshold on.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("gives malformed JSON a 400 through the real body parser", async () => {
    // The regression this file exists for: express.json() throws a SyntaxError
    // carrying status 400, and the handler used to collapse it to 500.
    const reportError = vi.fn();
    const a = express();
    a.use(express.json());
    a.post("/echo", (_req, res) => res.json({ ok: true }));
    a.use(errorHandler({ reportError }));

    const res = await request(a)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"altitude_km":');

    expect(res.status).toBe(400);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not echo a dependency's 5xx as the response status", async () => {
    const { a, reportError } = app(
      Object.assign(new Error("upstream down"), { status: 503 }),
    );
    const res = await request(a).post("/boom").send({});
    expect(res.status).toBe(500);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("terminates, without rewriting, a response already streaming", async () => {
    const reportError = vi.fn();
    const a = express();
    a.get("/stream", (_req, res) => {
      res.status(200).write("partial");
      throw new Error("failed mid-stream");
    });
    a.use(errorHandler({ reportError }));

    // Resolving at all is the assertion: the handler must end the response.
    // Before it did, this request hung until the test timed out.
    const res = await request(a).get("/stream");
    // The status was already committed; the handler must not try to rewrite it.
    expect(res.status).toBe(200);
    expect(res.text).toContain("partial");
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("handles a thrown non-Error without crashing", async () => {
    const { a } = app("just a string");
    const res = await request(a).post("/boom").send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "The request could not be completed." });
  });
});
