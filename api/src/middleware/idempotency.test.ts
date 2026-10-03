/**
 * Idempotency tests against real Postgres (PGlite).
 *
 * The behaviour that matters is what happens on the second request, so most of
 * these assert that the handler ran exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { bodyHash, claimKey, idempotency, recordOutcome } from "./idempotency";
import { createTestDb, type TestDb } from "../rag/testdb";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ROUTE = "POST /api/papers";
const KEY = "idem-key-0001";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

describe("bodyHash", () => {
  it("is stable across key order", () => {
    expect(bodyHash({ a: 1, b: 2 })).toBe(bodyHash({ b: 2, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
  });

  it("distinguishes nesting from flattening", () => {
    expect(bodyHash({ a: { b: 1 } })).not.toBe(bodyHash({ "a.b": 1 }));
  });

  it("ignores undefined values, which JSON drops anyway", () => {
    expect(bodyHash({ a: 1, b: undefined })).toBe(bodyHash({ a: 1 }));
  });

  it("respects array order", () => {
    expect(bodyHash([1, 2])).not.toBe(bodyHash([2, 1]));
  });

  it("handles primitives and null", () => {
    expect(bodyHash(null)).toBeTruthy();
    expect(bodyHash("x")).not.toBe(bodyHash("y"));
  });
});

describe("claimKey", () => {
  it("lets the first request proceed", async () => {
    expect(await claimKey(db, KEY, USER, ROUTE, "h1")).toEqual({
      kind: "proceed",
    });
  });

  it("reports a concurrent duplicate as in progress", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    expect(await claimKey(db, KEY, USER, ROUTE, "h1")).toEqual({
      kind: "in_progress",
    });
  });

  it("replays a completed response", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 201, { paper_id: "p1" });
    expect(await claimKey(db, KEY, USER, ROUTE, "h1")).toEqual({
      kind: "replay",
      status: 201,
      body: { paper_id: "p1" },
    });
  });

  it("rejects the same key with a different body", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 201, { ok: true });
    expect(await claimKey(db, KEY, USER, ROUTE, "DIFFERENT")).toEqual({
      kind: "body_mismatch",
    });
  });

  it("lets a retry through after a failed attempt", async () => {
    // Replaying a 500 forever would turn one transient fault into a permanent one.
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 500, { error: "upstream" });
    expect(await claimKey(db, KEY, USER, ROUTE, "h1")).toEqual({
      kind: "proceed",
    });
  });

  it("scopes keys per user", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    expect(await claimKey(db, KEY, OTHER, ROUTE, "h1")).toEqual({
      kind: "proceed",
    });
  });

  it("scopes keys per route", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    expect(
      await claimKey(db, KEY, USER, "POST /api/agent/solve", "h1"),
    ).toEqual({ kind: "proceed" });
  });

  it("lets exactly one of many concurrent claims proceed", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => claimKey(db, KEY, USER, ROUTE, "h1")),
    );
    expect(outcomes.filter((o) => o.kind === "proceed")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "in_progress")).toHaveLength(7);
  });

  it("degrades when the store is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error("down");
      },
    };
    expect(await claimKey(broken, KEY, USER, ROUTE, "h1")).toEqual({
      kind: "degraded",
    });
  });
});

describe("recordOutcome", () => {
  it("marks a 2xx as completed", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 200, { ok: true });
    const { rows } = await db.query<{ state: string }>(
      "SELECT state FROM public.idempotency_keys WHERE key = $1",
      [KEY],
    );
    expect(rows[0].state).toBe("completed");
  });

  it("marks a 4xx as completed, because the client will get the same answer again", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 422, { error: "not a PDF" });
    const { rows } = await db.query<{ state: string }>(
      "SELECT state FROM public.idempotency_keys WHERE key = $1",
      [KEY],
    );
    expect(rows[0].state).toBe("completed");
  });

  it("marks a 5xx as failed, so a retry may try again", async () => {
    await claimKey(db, KEY, USER, ROUTE, "h1");
    await recordOutcome(db, KEY, USER, ROUTE, 503, { error: "upstream" });
    const { rows } = await db.query<{ state: string }>(
      "SELECT state FROM public.idempotency_keys WHERE key = $1",
      [KEY],
    );
    expect(rows[0].state).toBe("failed");
  });
});

describe("idempotency middleware", () => {
  function app(
    handler?: (req: express.Request, res: express.Response) => void,
  ) {
    let calls = 0;
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.auth = { userId: USER, email: "a@b.c" };
      next();
    });
    a.post("/papers", idempotency(ROUTE, db), (req, res) => {
      calls += 1;
      if (handler) return handler(req, res);
      res.status(201).json({ paper_id: "p1", calls });
    });
    return { app: a, calls: () => calls };
  }

  it("runs the handler normally when no key is supplied", async () => {
    const { app: a, calls } = app();
    await request(a).post("/papers").send({ filename: "x.pdf" });
    await request(a).post("/papers").send({ filename: "x.pdf" });
    expect(calls()).toBe(2);
  });

  it("runs the handler once and replays the response on retry", async () => {
    const { app: a, calls } = app();
    const first = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ filename: "x.pdf" });
    const second = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ filename: "x.pdf" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(calls()).toBe(1);
  });

  it("rejects a reused key with a different body", async () => {
    const { app: a } = app();
    await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ filename: "x.pdf" });
    const res = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ filename: "OTHER.pdf" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/different request body/i);
  });

  it("rejects a key that is too short", async () => {
    const { app: a, calls } = app();
    const res = await request(a)
      .post("/papers")
      .set("Idempotency-Key", "abc")
      .send({});
    expect(res.status).toBe(400);
    expect(calls()).toBe(0);
  });

  it("rejects a key that is absurdly long", async () => {
    const { app: a } = app();
    const res = await request(a)
      .post("/papers")
      .set("Idempotency-Key", "k".repeat(500))
      .send({});
    expect(res.status).toBe(400);
  });

  it("requires authentication when a key is supplied", async () => {
    const a = express();
    a.use(express.json());
    a.post(
      "/papers",
      idempotency(ROUTE, db),
      (_req, res) => void res.status(201).json({}),
    );
    const res = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({});
    expect(res.status).toBe(401);
  });

  it("does not replay a 5xx; the retry runs the handler again", async () => {
    let attempt = 0;
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.auth = { userId: USER, email: "a@b.c" };
      next();
    });
    a.post("/papers", idempotency(ROUTE, db), (_req, res) => {
      attempt += 1;
      if (attempt === 1)
        return void res.status(503).json({ error: "upstream" });
      res.status(201).json({ paper_id: "p1" });
    });

    expect(
      (
        await request(a)
          .post("/papers")
          .set("Idempotency-Key", KEY)
          .send({ f: 1 })
      ).status,
    ).toBe(503);
    const retry = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ f: 1 });
    expect(retry.status).toBe(201);
    expect(attempt).toBe(2);
  });

  it("replays a 4xx, because the answer will not change", async () => {
    const { app: a, calls } = app(
      (_req, res) => void res.status(422).json({ error: "not a PDF" }),
    );
    await request(a).post("/papers").set("Idempotency-Key", KEY).send({ f: 1 });
    const retry = await request(a)
      .post("/papers")
      .set("Idempotency-Key", KEY)
      .send({ f: 1 });
    expect(retry.status).toBe(422);
    expect(calls()).toBe(1);
  });

  it("does not leave a 204 handler's row in progress forever", async () => {
    const { app: a } = app((_req, res) => void res.status(204).end());
    await request(a).post("/papers").set("Idempotency-Key", KEY).send({ f: 1 });
    await new Promise((r) => setTimeout(r, 30)); // the write is fire-and-forget
    const { rows } = await db.query<{ state: string }>(
      "SELECT state FROM public.idempotency_keys WHERE key = $1",
      [KEY],
    );
    expect(rows[0].state).toBe("completed");
  });

  it("runs the handler unprotected when the store is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error("down");
      },
    };
    let calls = 0;
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.auth = { userId: USER, email: "a@b.c" };
      next();
    });
    a.post("/papers", idempotency(ROUTE, broken), (_req, res) => {
      calls += 1;
      res.status(201).json({});
    });
    expect(
      (await request(a).post("/papers").set("Idempotency-Key", KEY).send({}))
        .status,
    ).toBe(201);
    expect(calls).toBe(1);
  });
});
