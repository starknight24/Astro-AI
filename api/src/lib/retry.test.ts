import { describe, expect, it, vi } from "vitest";
import { serverRetryDelayMs, withRetry } from "./retry";

/** No real waiting: the sleep and jitter are injected. */
const instant = { sleep: async () => {}, random: () => 0.5 };

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, instant)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("ok");
    expect(await withRetry(fn, instant)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("makes at most retries+1 attempts and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { ...instant, retries: 2 })).rejects.toThrow(
      "always",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry says no", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("4xx"));
    await expect(
      withRetry(fn, { ...instant, shouldRetry: () => false }),
    ).rejects.toThrow("4xx");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially, capped by maxDelayMs", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(
      withRetry(fn, {
        retries: 4,
        baseDelayMs: 100,
        maxDelayMs: 500,
        random: () => 1, // full jitter at its ceiling makes the ceiling observable
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();
    // ceilings: 100, 200, 400, 500 (capped)
    expect(delays).toEqual([100, 200, 400, 500]);
  });

  it("keeps every delay inside its jitter window", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        random: () => 0.75,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([75, 150, 300]);
  });

  it("prefers a server-provided delay over the computed backoff", async () => {
    // Measured: Gemini's 429 says "retryDelay":"27s" and a jittered 465 ms
    // retry against it just fails again, three times, for nothing.
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('{"@type":"...RetryInfo","retryDelay":"27s"}'),
      )
      .mockResolvedValue("ok");
    await withRetry(fn, {
      baseDelayMs: 500,
      random: () => 0.5,
      delayFor: serverRetryDelayMs,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([28_000]); // 27s + 1s padding
  });

  it("falls back to the backoff when there is no server hint", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("plain failure"))
      .mockResolvedValue("ok");
    await withRetry(fn, {
      baseDelayMs: 500,
      random: () => 1,
      delayFor: serverRetryDelayMs,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([500]);
  });

  it("passes the attempt index to the function", async () => {
    const seen: number[] = [];
    await expect(
      withRetry(
        async (attempt) => {
          seen.push(attempt);
          throw new Error("nope");
        },
        { ...instant, retries: 2 },
      ),
    ).rejects.toThrow();
    expect(seen).toEqual([0, 1, 2]);
  });

  it("reports each retry through onRetry", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(1);
    await withRetry(fn, { ...instant, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("serverRetryDelayMs", () => {
  it("parses Gemini's retry hint and pads it by a second", () => {
    expect(serverRetryDelayMs(new Error('"retryDelay":"27s"'))).toBe(28_000);
    expect(serverRetryDelayMs(new Error('"retryDelay": "0.5s"'))).toBe(1500);
  });

  it("returns null when there is no hint", () => {
    expect(serverRetryDelayMs(new Error("503 UNAVAILABLE"))).toBeNull();
    expect(serverRetryDelayMs("not an error")).toBeNull();
  });

  it("caps a pathological hint so a request cannot hang indefinitely", () => {
    expect(serverRetryDelayMs(new Error('"retryDelay":"9999s"'))).toBe(120_000);
  });

  it("ignores a non-positive hint", () => {
    expect(serverRetryDelayMs(new Error('"retryDelay":"0s"'))).toBeNull();
  });
});
