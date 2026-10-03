/**
 * Rate-limit tests against real Postgres (PGlite).
 *
 * The thing most likely to be wrong is the atomic upsert — whether two
 * concurrent requests can both see the same count — and that is not testable
 * against a mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimit,
  sweepRateLimits,
} from "./rateLimit";
import { createTestDb, type TestDb } from "../rag/testdb";

let db: TestDb;
const RULE = { bucket: "test", limit: 3, windowMs: 60_000 };

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and then refuses", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkRateLimit(db, RULE, ["user:a"]));
    }
    expect(results.map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("counts down the remaining allowance", async () => {
    expect((await checkRateLimit(db, RULE, ["user:a"])).remaining).toBe(2);
    expect((await checkRateLimit(db, RULE, ["user:a"])).remaining).toBe(1);
    expect((await checkRateLimit(db, RULE, ["user:a"])).remaining).toBe(0);
  });

  it("never reports a negative remaining", async () => {
    for (let i = 0; i < 6; i++) await checkRateLimit(db, RULE, ["user:a"]);
    expect((await checkRateLimit(db, RULE, ["user:a"])).remaining).toBe(0);
  });

  it("keeps separate allowances per key", async () => {
    for (let i = 0; i < 4; i++) await checkRateLimit(db, RULE, ["user:a"]);
    expect((await checkRateLimit(db, RULE, ["user:b"])).allowed).toBe(true);
  });

  it("keeps separate allowances per bucket", async () => {
    for (let i = 0; i < 4; i++) await checkRateLimit(db, RULE, ["user:a"]);
    const other = await checkRateLimit(db, { ...RULE, bucket: "other" }, [
      "user:a",
    ]);
    expect(other.allowed).toBe(true);
  });

  it("checks every key and reports the one that tripped", async () => {
    // One account at its limit must block even when the IP is fresh.
    for (let i = 0; i < 3; i++) await checkRateLimit(db, RULE, ["user:a"]);
    const decision = await checkRateLimit(db, RULE, ["user:a", "ip:1.2.3.4"]);
    expect(decision.allowed).toBe(false);
    expect(decision.trippedKey).toBe("user:a");
  });

  it("blocks on the IP key even when the user key is fresh", async () => {
    for (let i = 0; i < 3; i++) await checkRateLimit(db, RULE, ["ip:1.2.3.4"]);
    const decision = await checkRateLimit(db, RULE, ["user:new", "ip:1.2.3.4"]);
    expect(decision.allowed).toBe(false);
    expect(decision.trippedKey).toBe("ip:1.2.3.4");
  });

  it("starts a fresh allowance in the next window", async () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 4; i++) await checkRateLimit(db, RULE, ["user:a"], now);
    expect((await checkRateLimit(db, RULE, ["user:a"], now)).allowed).toBe(
      false,
    );
    const next = now + RULE.windowMs;
    expect((await checkRateLimit(db, RULE, ["user:a"], next)).allowed).toBe(
      true,
    );
  });

  it("reports when the current window ends", async () => {
    const now = 1_700_000_000_000;
    const decision = await checkRateLimit(db, RULE, ["user:a"], now);
    const expected = Math.floor(
      (Math.floor(now / RULE.windowMs) * RULE.windowMs + RULE.windowMs) / 1000,
    );
    expect(decision.resetAt).toBe(expected);
  });

  it("increments atomically under concurrency", async () => {
    // Ten parallel requests against a limit of 3 must yield exactly 3 allowed.
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit(db, RULE, ["user:a"])),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
  });

  it("fails OPEN when the store is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error('relation "public.rate_limit_counters" does not exist');
      },
    };
    const decision = await checkRateLimit(broken, RULE, ["user:a"]);
    expect(decision.allowed).toBe(true);
    expect(decision.degraded).toBe(true);
  });
});

describe("rateLimit middleware", () => {
  function app(rule = RULE) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.auth = {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "a@b.c",
      };
      next();
    });
    a.use(rateLimit(rule, db));
    a.get("/thing", (_req, res) => void res.json({ ok: true }));
    return a;
  }

  it("sets the draft RFC headers on a permitted request", async () => {
    const res = await request(app()).get("/thing");
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("3");
    expect(res.headers["ratelimit-remaining"]).toBe("2");
    expect(Number(res.headers["ratelimit-reset"])).toBeGreaterThan(0);
  });

  it("returns 429 with Retry-After once the allowance is spent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = app();
    for (let i = 0; i < 3; i++) await request(server).get("/thing");
    const res = await request(server).get("/thing");
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.body.retry_after_seconds).toBeGreaterThan(0);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it("does not leak which key tripped to the client", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = app();
    for (let i = 0; i < 4; i++) await request(server).get("/thing");
    const res = await request(server).get("/thing");
    expect(JSON.stringify(res.body)).not.toContain("user:");
    expect(JSON.stringify(res.body)).not.toContain("ip:");
  });

  it("lets the request through when the store is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      query: async () => {
        throw new Error("down");
      },
    };
    const a = express();
    a.use(rateLimit(RULE, broken));
    a.get("/thing", (_req, res) => void res.json({ ok: true }));
    expect((await request(a).get("/thing")).status).toBe(200);
  });
});

describe("configured buckets", () => {
  it("gives the agent a far smaller allowance than the plain API", () => {
    expect(RATE_LIMITS.agent.limit).toBeLessThan(RATE_LIMITS.api.limit);
    expect(RATE_LIMITS.upload.limit).toBeLessThan(RATE_LIMITS.api.limit);
  });

  it("uses an hour-long window for the expensive buckets", () => {
    expect(RATE_LIMITS.agent.windowMs).toBe(3_600_000);
    expect(RATE_LIMITS.upload.windowMs).toBe(3_600_000);
  });

  it("keeps the agent allowance within one day of free-tier model quota", () => {
    // 3 model calls per agent run; the free tier allows 20/day/model.
    expect(RATE_LIMITS.agent.limit * 3).toBeLessThanOrEqual(30);
  });
});

describe("sweepRateLimits", () => {
  it("deletes windows older than the cutoff and keeps current ones", async () => {
    const old = new Date(Date.now() - 48 * 3_600_000);
    await db.query(
      "INSERT INTO public.rate_limit_counters (bucket, key, window_start, count) VALUES ($1,$2,$3,$4)",
      ["test", "user:old", old, 5],
    );
    await checkRateLimit(db, RULE, ["user:current"]);
    expect(await sweepRateLimits(db, 24 * 3_600_000)).toBe(1);
    const { rows } = await db.query<{ key: string }>(
      "SELECT key FROM public.rate_limit_counters",
    );
    expect(rows.map((r) => r.key)).toEqual(["user:current"]);
  });
});
