/**
 * The agent's tool registry.
 *
 * One entry per tool, each carrying everything the loop needs: the Gemini
 * function declaration, a Zod schema, a per-tool timeout, and an executor.
 * Adding a tool means adding one object here — the loop never names a tool.
 *
 * DECISION (ADR-005): deterministic work is delegated, never modelled.
 * `orbital_calculator` is a thin pass-through to the Python engine (ADR-003),
 * `iss_position` to SGP4 propagation, and the NASA tools to NASA's own APIs.
 * The agent chooses *which* to call and explains the result; it never computes.
 */
import { z, type ZodType } from "zod";
import { Type, type FunctionDeclaration } from "@google/genai";
import { postToScience } from "../lib/scienceClient";
import { getApod, getNeoById, getNeoFeed, NasaApiError } from "../lib/nasa";
import { withRetry } from "../lib/retry";

const SCIENCE_URL = process.env.SCIENCE_URL;
if (!SCIENCE_URL) {
  throw new Error(
    "SCIENCE_URL is required. Set it in api/.env for local dev and in the production environment settings.",
  );
}
const SCIENCE_BASE: string = SCIENCE_URL.replace(/\/+$/, "");

/** A tool failure the loop may retry (network, timeout, 5xx). */
export class ToolTransientError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "ToolTransientError";
  }
}

/** A tool failure caused by the arguments; retrying cannot help. */
export class ToolInputError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export interface ToolDefinition<T = unknown> {
  name: string;
  /** Shown to the model. States units explicitly — unit drift is the main failure mode. */
  description: string;
  schema: ZodType<T>;
  declaration: FunctionDeclaration;
  /** Per-tool wall clock. Exceeding it aborts the call. */
  timeoutMs: number;
  /** Retries after the first attempt, for transient failures only. */
  retries: number;
  execute: (args: T, signal: AbortSignal) => Promise<unknown>;
}

// ---------- science service helper ----------

async function callScience(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw new ToolTransientError("aborted before dispatch");
  const outcome = await postToScience(SCIENCE_BASE, path, body);
  if (outcome.kind === "network") {
    throw new ToolTransientError(
      `science service unreachable: ${outcome.message}`,
    );
  }
  if (outcome.status >= 500) {
    throw new ToolTransientError(`science service responded ${outcome.status}`);
  }
  if (outcome.status === 422 || outcome.status === 400) {
    const detail =
      outcome.body &&
      typeof outcome.body === "object" &&
      "detail" in outcome.body
        ? JSON.stringify((outcome.body as { detail: unknown }).detail)
        : `status ${outcome.status}`;
    throw new ToolInputError(
      `science service rejected the arguments: ${detail}`,
    );
  }
  if (outcome.status !== 200) {
    throw new ToolTransientError(`science service responded ${outcome.status}`);
  }
  return outcome.body;
}

async function getScience(path: string, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new ToolTransientError("aborted before dispatch");
  const res = await fetch(`${SCIENCE_BASE}${path}`, { signal }).catch(
    (err: unknown) => {
      throw new ToolTransientError(
        `science service unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );
  if (res.status === 503)
    throw new ToolTransientError("science service: upstream data unavailable");
  if (!res.ok)
    throw new ToolTransientError(`science service responded ${res.status}`);
  return (await res.json()) as unknown;
}

// ---------- orbital_calculator ----------

const OPERATIONS = [
  "period",
  "velocity",
  "escape_velocity",
  "vis_viva",
  "energy",
  "hohmann",
] as const;
type Operation = (typeof OPERATIONS)[number];

/** Which parameters each operation needs. Drives both validation and errors. */
const OPERATION_PARAMS: Record<Operation, string[]> = {
  period: ["altitude_km"],
  velocity: ["altitude_km"],
  escape_velocity: ["altitude_km"],
  vis_viva: ["altitude_km", "semi_major_axis_km"],
  energy: ["semi_major_axis_km"],
  hohmann: ["alt1_km", "alt2_km"],
};

const OrbitalArgs = z
  .object({
    operation: z.enum(OPERATIONS),
    altitude_km: z.number().finite().min(0).max(1e9).optional(),
    semi_major_axis_km: z.number().finite().positive().max(1e9).optional(),
    alt1_km: z.number().finite().min(0).max(1e9).optional(),
    alt2_km: z.number().finite().min(0).max(1e9).optional(),
  })
  .superRefine((value, ctx) => {
    for (const param of OPERATION_PARAMS[value.operation]) {
      if (value[param as keyof typeof value] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [param],
          message: `operation '${value.operation}' requires '${param}' (km, above Earth's surface)`,
        });
      }
    }
  });

type OrbitalArgsT = z.infer<typeof OrbitalArgs>;

const SCIENCE_PATHS: Record<Operation, string> = {
  period: "/calculate/period",
  velocity: "/calculate/velocity",
  escape_velocity: "/calculate/escape-velocity",
  vis_viva: "/calculate/vis-viva",
  energy: "/calculate/energy",
  hohmann: "/calculate/hohmann",
};

function orbitalBody(args: OrbitalArgsT): Record<string, number> {
  switch (args.operation) {
    case "period":
    case "velocity":
    case "escape_velocity":
      return { altitude_km: args.altitude_km as number };
    case "vis_viva":
      return {
        altitude_km: args.altitude_km as number,
        semi_major_axis_km: args.semi_major_axis_km as number,
      };
    case "energy":
      return { semi_major_axis_km: args.semi_major_axis_km as number };
    case "hohmann":
      return {
        alt1_km: args.alt1_km as number,
        alt2_km: args.alt2_km as number,
      };
  }
}

const orbitalCalculator: ToolDefinition<OrbitalArgsT> = {
  name: "orbital_calculator",
  description: [
    "Deterministic Earth-orbit mechanics from the project's Python physics engine.",
    "ALL distances are kilometres, times seconds, velocities km/s.",
    "'altitude_km' is height above Earth's surface (the engine adds R_earth = 6378.137 km itself).",
    "'semi_major_axis_km' is an orbital RADIUS measured from Earth's centre, not an altitude.",
    "operation: period | velocity | escape_velocity (need altitude_km);",
    "vis_viva (needs altitude_km + semi_major_axis_km); energy (needs semi_major_axis_km);",
    "hohmann (needs alt1_km + alt2_km).",
    "Returns the computed values plus the formula used. Never compute orbital mechanics yourself — call this.",
  ].join(" "),
  schema: OrbitalArgs,
  timeoutMs: 10_000,
  retries: 2,
  declaration: {
    name: "orbital_calculator",
    description:
      "Deterministic Earth-orbit mechanics (km, s, km/s). altitude_km = height above the surface; semi_major_axis_km = radius from Earth's centre.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          enum: [...OPERATIONS],
          description:
            "period|velocity|escape_velocity use altitude_km; vis_viva uses altitude_km+semi_major_axis_km; energy uses semi_major_axis_km; hohmann uses alt1_km+alt2_km.",
        },
        altitude_km: {
          type: Type.NUMBER,
          description: "Altitude above Earth's surface, km.",
        },
        semi_major_axis_km: {
          type: Type.NUMBER,
          description: "Semi-major axis (radius from Earth's centre), km.",
        },
        alt1_km: {
          type: Type.NUMBER,
          description: "Hohmann: initial circular orbit altitude, km.",
        },
        alt2_km: {
          type: Type.NUMBER,
          description: "Hohmann: target circular orbit altitude, km.",
        },
      },
      required: ["operation"],
    },
  },
  execute: async (args, signal) => {
    const body = await callScience(
      SCIENCE_PATHS[args.operation],
      orbitalBody(args),
      signal,
    );
    // The engine returns values and a formula but names no source. Attaching one
    // here keeps orbital.py's contract untouched while giving the synthesiser a
    // real string to cite instead of improvising one from the arguments.
    return body && typeof body === "object"
      ? {
          ...body,
          source: `AstroAI deterministic physics engine, orbital.${args.operation} (science/orbital.py)`,
        }
      : body;
  },
};

// ---------- iss_position ----------

const IssArgs = z
  .object({
    mode: z
      .enum(["current_position", "next_passes"])
      .default("current_position"),
    place: z.string().trim().min(1).max(80).optional(),
    lat_deg: z.number().finite().min(-90).max(90).optional(),
    lon_deg: z.number().finite().min(-180).max(180).optional(),
    days: z.number().finite().gt(0).max(10).optional(),
    min_elevation_deg: z.number().finite().min(0).lt(90).optional(),
    max_passes: z.number().int().min(1).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "next_passes") return;
    const hasCoords =
      value.lat_deg !== undefined && value.lon_deg !== undefined;
    if (!value.place && !hasCoords) {
      ctx.addIssue({
        code: "custom",
        path: ["place"],
        message:
          "mode 'next_passes' needs a ground site: pass 'place' (a city name) or both 'lat_deg' and 'lon_deg'.",
      });
    }
  });

type IssArgsT = z.infer<typeof IssArgs>;

const issPosition: ToolDefinition<IssArgsT> = {
  name: "iss_position",
  description: [
    "Live ISS state from the current Celestrak TLE, propagated with SGP4.",
    "mode 'current_position' returns the sub-satellite latitude/longitude and altitude now.",
    "mode 'next_passes' returns upcoming visible passes over a ground site: give 'place'",
    "(a city name such as 'Toronto') or both 'lat_deg' and 'lon_deg'.",
    "Times are UTC ISO-8601. Elevations and azimuths are degrees; ranges km.",
    "An unknown place name is an error, not a guess — relay it and ask for coordinates.",
  ].join(" "),
  schema: IssArgs,
  // Pass prediction scans up to 10 days of 30-second steps, so it gets more room.
  timeoutMs: 25_000,
  retries: 1,
  declaration: {
    name: "iss_position",
    description:
      "ISS position now, or its next passes over a ground site, from the current TLE via SGP4. UTC times, degrees, km.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          enum: ["current_position", "next_passes"],
          description:
            "'current_position' for where it is now; 'next_passes' for pass predictions.",
        },
        place: {
          type: Type.STRING,
          description: "Ground site city name, e.g. 'Toronto'.",
        },
        lat_deg: {
          type: Type.NUMBER,
          description: "Ground site latitude, degrees (-90..90).",
        },
        lon_deg: {
          type: Type.NUMBER,
          description: "Ground site longitude, degrees (-180..180).",
        },
        days: {
          type: Type.NUMBER,
          description: "How far ahead to search, days (default 2, max 10).",
        },
        min_elevation_deg: {
          type: Type.NUMBER,
          description:
            "Minimum peak elevation for a pass to count, degrees (default 10).",
        },
        max_passes: {
          type: Type.NUMBER,
          description: "Cap on returned passes (default 3).",
        },
      },
      required: ["mode"],
    },
  },
  execute: async (args, signal) => {
    if (args.mode === "current_position") {
      return getScience("/iss/position", signal);
    }
    const body: Record<string, unknown> = {
      days: args.days ?? 2,
      min_elevation_deg: args.min_elevation_deg ?? 10,
      max_passes: args.max_passes ?? 3,
    };
    if (args.place) body.place = args.place;
    else {
      body.lat_deg = args.lat_deg;
      body.lon_deg = args.lon_deg;
    }
    return callScience("/iss/passes", body, signal);
  },
};

// ---------- apod ----------

const ApodArgs = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
});
type ApodArgsT = z.infer<typeof ApodArgs>;

const apod: ToolDefinition<ApodArgsT> = {
  name: "apod",
  description:
    "NASA Astronomy Picture of the Day: title, date, image URL and NASA's own explanation. Omit 'date' for today, or pass YYYY-MM-DD (not before 1995-06-16). Cached for one hour.",
  schema: ApodArgs,
  timeoutMs: 15_000,
  retries: 0, // the NASA client already retries internally
  declaration: {
    name: "apod",
    description:
      "NASA Astronomy Picture of the Day for today or a given YYYY-MM-DD date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "YYYY-MM-DD; omit for today." },
      },
    },
  },
  execute: async (args) => {
    try {
      const { data, cached } = await getApod(args.date);
      return { ...data, cache_hit: cached };
    } catch (err) {
      throw wrapNasaError(err);
    }
  },
};

// ---------- neo_lookup ----------

const NeoArgs = z
  .object({
    asteroid_id: z
      .string()
      .regex(/^\d{1,12}$/, "asteroid_id must be a NeoWs numeric id")
      .optional(),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD")
      .optional(),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD")
      .optional(),
    hazardous_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.asteroid_id && (value.start_date || value.end_date)) {
      ctx.addIssue({
        code: "custom",
        path: ["asteroid_id"],
        message: "Pass either 'asteroid_id' or a date range, not both.",
      });
    }
  });
type NeoArgsT = z.infer<typeof NeoArgs>;

const neoLookup: ToolDefinition<NeoArgsT> = {
  name: "neo_lookup",
  description: [
    "NASA NeoWs near-Earth object data.",
    "Give a date range ('start_date'/'end_date', YYYY-MM-DD, at most 7 days apart, default today)",
    "to list close approaches sorted by miss distance, or 'asteroid_id' for one object.",
    "Diameters are metres, miss distances kilometres and lunar distances, velocities km/s.",
    "'hazardous_only' keeps only objects NASA flags as potentially hazardous. Cached for one hour.",
  ].join(" "),
  schema: NeoArgs,
  timeoutMs: 20_000,
  retries: 0,
  declaration: {
    name: "neo_lookup",
    description:
      "NASA near-Earth object close approaches for a date range (max 7 days), or one object by NeoWs id. Metres, km, km/s.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        asteroid_id: {
          type: Type.STRING,
          description: "NeoWs numeric object id.",
        },
        start_date: {
          type: Type.STRING,
          description: "YYYY-MM-DD; defaults to today.",
        },
        end_date: {
          type: Type.STRING,
          description: "YYYY-MM-DD; defaults to start_date.",
        },
        hazardous_only: {
          type: Type.BOOLEAN,
          description: "Keep only potentially hazardous objects.",
        },
        limit: {
          type: Type.NUMBER,
          description: "Max objects to return (1-25, default 10).",
        },
      },
    },
  },
  execute: async (args) => {
    try {
      if (args.asteroid_id) {
        const { data, cached } = await getNeoById(args.asteroid_id);
        return { ...data, cache_hit: cached };
      }
      const { data, cached } = await getNeoFeed(args);
      return { ...data, cache_hit: cached };
    } catch (err) {
      throw wrapNasaError(err);
    }
  },
};

function wrapNasaError(err: unknown): Error {
  if (err instanceof NasaApiError) {
    return err.retryable
      ? new ToolTransientError(err.message)
      : new ToolInputError(err.message);
  }
  return new ToolTransientError(
    err instanceof Error ? err.message : String(err),
  );
}

// ---------- registry ----------

export const TOOLS: ToolDefinition<never>[] = [
  orbitalCalculator,
  issPosition,
  apod,
  neoLookup,
] as unknown as ToolDefinition<never>[];

export const TOOL_BY_NAME: Map<string, ToolDefinition<never>> = new Map(
  TOOLS.map((t) => [t.name, t]),
);

export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

export function functionDeclarations(): FunctionDeclaration[] {
  return TOOLS.map((t) => t.declaration);
}

export interface ToolRunOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  errorKind?: "validation" | "input" | "transient" | "timeout" | "unknown_tool";
  attempts: number;
  durationMs: number;
  /** Repairs applied to model-supplied arguments, for the trace. */
  coercions?: string[];
  validatedArgs?: unknown;
}

/**
 * Validate then execute one tool call: Zod first, then the executor under a
 * per-tool timeout with backoff on transient failures only.
 *
 * Failures are returned, not thrown: the loop feeds the message back to the
 * model so it can correct its arguments, which is the whole point of validating
 * at this boundary.
 */
export async function runTool(
  name: string,
  rawArgs: Record<string, unknown>,
  coercions: string[] = [],
): Promise<ToolRunOutcome> {
  const started = Date.now();
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      error: `Unknown tool '${name}'. Available tools: ${TOOL_NAMES.join(", ")}.`,
      errorKind: "unknown_tool",
      attempts: 0,
      durationMs: Date.now() - started,
    };
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      error: `Invalid arguments for ${name}: ${issues}`,
      errorKind: "validation",
      attempts: 0,
      durationMs: Date.now() - started,
      coercions,
    };
  }

  let attempts = 0;
  try {
    const result = await withRetry(
      async () => {
        attempts += 1;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        // The timeout is raced against the executor rather than relying on the
        // abort signal alone: an executor that ignores its signal must still not
        // be able to hang the agent. The abandoned call cannot be killed, but the
        // loop stops waiting for it.
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new ToolTransientError(
                `${name} timed out after ${tool.timeoutMs} ms`,
              ),
            );
          }, tool.timeoutMs);
        });
        try {
          return await Promise.race([
            tool.execute(parsed.data as never, controller.signal),
            timeout,
          ]);
        } catch (err) {
          if (
            controller.signal.aborted &&
            !(err instanceof ToolTransientError)
          ) {
            throw new ToolTransientError(
              `${name} timed out after ${tool.timeoutMs} ms`,
            );
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        retries: tool.retries,
        shouldRetry: (err) => err instanceof ToolTransientError,
        onRetry: (err, attempt, delay) =>
          console.warn(
            `tool ${name} attempt ${attempt + 1} failed (${err instanceof Error ? err.message : err}); retrying in ${delay} ms`,
          ),
      },
    );
    return {
      ok: true,
      result,
      attempts,
      durationMs: Date.now() - started,
      coercions,
      validatedArgs: parsed.data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind: ToolRunOutcome["errorKind"] =
      err instanceof ToolInputError
        ? "input"
        : /timed out/.test(message)
          ? "timeout"
          : "transient";
    return {
      ok: false,
      error: message,
      errorKind: kind,
      attempts,
      durationMs: Date.now() - started,
      coercions,
      validatedArgs: parsed.data,
    };
  }
}
