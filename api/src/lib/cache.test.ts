import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Postgres layer is mocked: these tests assert the memory layer's behaviour
// and that a failing database degrades instead of throwing.
const query = vi.fn();
vi.mock("./db", () => ({
  pool: { query: (...args: unknown[]) => query(...args) },
}));

const { cacheGet, cacheSet, clearMemoryCache, withCache, ONE_HOUR_MS } =
  await import("./cache");

describe("cache", () => {
  beforeEach(() => {
    clearMemoryCache();
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns null for a key that was never set", async () => {
    expect(await cacheGet("missing")).toBeNull();
  });

  it("round-trips a value through the memory layer", async () => {
    await cacheSet("k", { a: 1 }, ONE_HOUR_MS);
    expect(await cacheGet("k")).toEqual({ a: 1 });
  });

  it("expires a value once its TTL elapses", async () => {
    await cacheSet("k", "v", 1000);
    vi.advanceTimersByTime(999);
    expect(await cacheGet("k")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(await cacheGet("k")).toBeNull();
  });

  it("computes once and serves the cached value afterwards", async () => {
    const compute = vi.fn().mockResolvedValue("fresh");
    const first = await withCache("k", ONE_HOUR_MS, compute);
    const second = await withCache("k", ONE_HOUR_MS, compute);
    expect(first).toEqual({ value: "fresh", cached: false });
    expect(second).toEqual({ value: "fresh", cached: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes after the entry expires", async () => {
    const compute = vi
      .fn()
      .mockResolvedValueOnce("one")
      .mockResolvedValueOnce("two");
    await withCache("k", 1000, compute);
    vi.advanceTimersByTime(1001);
    expect(await withCache("k", 1000, compute)).toEqual({
      value: "two",
      cached: false,
    });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("promotes a Postgres hit into the memory layer", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { value: { from: "pg" }, expires_at: new Date(Date.now() + 60_000) },
      ],
    });
    expect(await cacheGet("k")).toEqual({ from: "pg" });
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    // Second read is served from memory, so Postgres is not queried again.
    expect(await cacheGet("k")).toEqual({ from: "pg" });
    expect(query).not.toHaveBeenCalled();
  });

  it("degrades to memory-only when Postgres is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    query.mockRejectedValue(
      new Error('relation "public.api_cache" does not exist'),
    );
    await expect(cacheSet("k", "v", ONE_HOUR_MS)).resolves.toBeUndefined();
    expect(await cacheGet("k")).toBe("v"); // memory still works
  });

  it("does not throw when a compute function rejects", async () => {
    await expect(
      withCache("k", ONE_HOUR_MS, async () => {
        throw new Error("upstream down");
      }),
    ).rejects.toThrow("upstream down");
    expect(await cacheGet("k")).toBeNull();
  });
});
