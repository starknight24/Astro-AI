import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("pg", () => ({
  default: {
    Pool: class {
      query = (...a: unknown[]) => query(...a);
    },
  },
}));

const { clearKnownUsers, upsertUser } = await import("./db");

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  clearKnownUsers();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertUser", () => {
  it("writes the row on the first request for a user", async () => {
    await upsertUser(USER, "a@b.c");
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("ON CONFLICT");
  });

  it("skips the database on later requests for the same user", async () => {
    // Measured: this round trip was ~0.90 ms p50 on every authenticated request,
    // for a statement that is a no-op after the first success.
    for (let i = 0; i < 50; i++) await upsertUser(USER, "a@b.c");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("still writes for a different user", async () => {
    await upsertUser(USER, "a@b.c");
    await upsertUser("22222222-2222-4222-8222-222222222222", "c@d.e");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("retries on the next request when the write failed", async () => {
    // A transient outage must not leave the row missing for the process's life.
    query.mockRejectedValueOnce(new Error("connection refused"));
    await expect(upsertUser(USER, "a@b.c")).rejects.toThrow();
    query.mockResolvedValue({ rows: [] });
    await upsertUser(USER, "a@b.c");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("writes again once the cache entry has expired", async () => {
    vi.useFakeTimers();
    await upsertUser(USER, "a@b.c");
    vi.advanceTimersByTime(61 * 60 * 1000);
    await upsertUser(USER, "a@b.c");
    expect(query).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not grow without bound", async () => {
    for (let i = 0; i < 5100; i++) {
      await upsertUser(`user-${i}`, "a@b.c");
    }
    // The earliest users were evicted, so re-requesting one writes again.
    query.mockClear();
    await upsertUser("user-0", "a@b.c");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
