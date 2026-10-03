import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("./db", () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const { clearMemoryCache } = await import("./cache");
const { NasaApiError, getApod, getNeoById, getNeoFeed } =
  await import("./nasa");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const APOD_BODY = {
  date: "2026-09-30",
  title: "Arp 78",
  explanation: "Peculiar spiral galaxy Arp 78 …",
  url: "https://apod.nasa.gov/img.jpg",
  media_type: "image",
  copyright: " Some Photographer ",
};

const NEO_BODY = {
  element_count: 2,
  near_earth_objects: {
    "2026-09-30": [
      {
        id: "3132507",
        name: "(2002 PN6)",
        absolute_magnitude_h: 20.9,
        is_potentially_hazardous_asteroid: false,
        nasa_jpl_url: "https://ssd.jpl.nasa.gov/x",
        estimated_diameter: {
          meters: {
            estimated_diameter_min: 175.6123,
            estimated_diameter_max: 392.681,
          },
        },
        close_approach_data: [
          {
            close_approach_date: "2026-09-30",
            close_approach_date_full: "2026-Sep-30 17:42",
            orbiting_body: "Earth",
            miss_distance: { kilometers: "62349988.911", lunar: "162.1289" },
            relative_velocity: { kilometers_per_second: "1.5721996" },
          },
        ],
      },
      {
        id: "999",
        name: "(hazard)",
        is_potentially_hazardous_asteroid: true,
        estimated_diameter: {
          meters: { estimated_diameter_min: 10, estimated_diameter_max: 20 },
        },
        close_approach_data: [
          {
            close_approach_date: "2026-09-30",
            miss_distance: { kilometers: "1000000", lunar: "2.6" },
            relative_velocity: { kilometers_per_second: "9.9" },
          },
        ],
      },
    ],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearMemoryCache();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getApod", () => {
  it("shapes the response and records its source", async () => {
    fetchMock.mockResolvedValue(jsonResponse(APOD_BODY));
    const { data, cached } = await getApod();
    expect(cached).toBe(false);
    expect(data.title).toBe("Arp 78");
    expect(data.copyright).toBe("Some Photographer"); // trimmed
    expect(data.source).toContain("NASA APOD, 2026-09-30");
  });

  it("never puts the api key in an error message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    await expect(getApod()).rejects.toThrow(/responded 403/);
    await expect(getApod()).rejects.not.toThrow(/TEST_KEY/);
  });

  it("sends the api key as a query parameter", async () => {
    fetchMock.mockResolvedValue(jsonResponse(APOD_BODY));
    await getApod();
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("api_key")).toBe("TEST_KEY");
    expect(url.pathname).toBe("/planetary/apod");
  });

  it("serves a second identical call from the cache", async () => {
    fetchMock.mockResolvedValue(jsonResponse(APOD_BODY));
    await getApod("2026-09-30");
    const second = await getApod("2026-09-30");
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 and succeeds on the next attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(APOD_BODY));
    const { data } = await getApod();
    expect(data.title).toBe("Arp 78");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 (DEMO_KEY rate limit)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(APOD_BODY));
    await expect(getApod()).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(getApod()).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget and reports the failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(getApod()).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("surfaces a timeout as a retryable error", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    fetchMock.mockRejectedValue(abortErr);
    await expect(getApod()).rejects.toThrow(/timed out/);
  });

  it("rejects a malformed date without calling NASA", async () => {
    await expect(getApod("30-09-2026")).rejects.toThrow(/YYYY-MM-DD/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getNeoFeed", () => {
  it("summarises objects and sorts them by miss distance", async () => {
    fetchMock.mockResolvedValue(jsonResponse(NEO_BODY));
    const { data } = await getNeoFeed({ start_date: "2026-09-30" });
    expect(data.objects.map((o) => o.id)).toEqual(["999", "3132507"]);
    expect(data.closest?.id).toBe("999");
    expect(data.hazardous_count).toBe(1);
    expect(data.element_count).toBe(2);
  });

  it("converts NeoWs string numerics into numbers with units in the field names", async () => {
    fetchMock.mockResolvedValue(jsonResponse(NEO_BODY));
    const { data } = await getNeoFeed({ start_date: "2026-09-30" });
    const neo = data.objects.find((o) => o.id === "3132507");
    expect(neo?.miss_distance_km).toBe(62349989);
    expect(neo?.miss_distance_lunar).toBe(162.13);
    expect(neo?.relative_velocity_kms).toBe(1.572);
    expect(neo?.diameter_min_m).toBe(175.6);
  });

  it("filters to hazardous objects on request", async () => {
    fetchMock.mockResolvedValue(jsonResponse(NEO_BODY));
    const { data } = await getNeoFeed({
      start_date: "2026-09-30",
      hazardous_only: true,
    });
    expect(data.objects).toHaveLength(1);
    expect(data.objects[0].is_potentially_hazardous).toBe(true);
  });

  it("honours the limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse(NEO_BODY));
    const { data } = await getNeoFeed({ start_date: "2026-09-30", limit: 1 });
    expect(data.objects).toHaveLength(1);
  });

  it("rejects a range longer than NeoWs allows", async () => {
    await expect(
      getNeoFeed({ start_date: "2026-09-01", end_date: "2026-09-30" }),
    ).rejects.toThrow(/7-day/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a reversed range", async () => {
    await expect(
      getNeoFeed({ start_date: "2026-09-10", end_date: "2026-09-01" }),
    ).rejects.toThrow(/must not precede/);
  });

  it("marks range errors as not retryable", async () => {
    await expect(getNeoFeed({ start_date: "nope" })).rejects.toSatisfy(
      (e: unknown) => e instanceof NasaApiError && e.retryable === false,
    );
  });

  it("caches the upstream feed, not the filtered view", async () => {
    fetchMock.mockResolvedValue(jsonResponse(NEO_BODY));
    await getNeoFeed({ start_date: "2026-09-30" });
    const filtered = await getNeoFeed({
      start_date: "2026-09-30",
      hazardous_only: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(filtered.cached).toBe(true);
    expect(filtered.data.objects).toHaveLength(1);
  });
});

describe("getNeoById", () => {
  it("rejects a non-numeric id without calling NASA", async () => {
    await expect(getNeoById("apophis")).rejects.toThrow(/numeric/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a summarised object with a source string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(NEO_BODY.near_earth_objects["2026-09-30"][0]),
    );
    const { data } = await getNeoById("3132507");
    expect(data.name).toBe("(2002 PN6)");
    expect(data.source).toContain("3132507");
  });
});
