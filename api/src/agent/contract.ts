/**
 * The solver output contract.
 *
 * Every agent answer has the same five parts — steps, formulas, citations,
 * final answer, units — so the frontend can render it, the eval harness can
 * grade it, and a reader can check the work. The model is constrained to this
 * shape with a Gemini `responseSchema` (the pattern already used by the older
 * endpoints in server.ts), not asked politely in prose.
 */
import { Type, type Schema } from "@google/genai";

/**
 * Bump when a prompt changes, so `agent_traces.prompt_version` stays meaningful.
 *
 * v2 (2026-09-30, from docs/failure-modes.md): separated "out of domain" from
 * "cannot be answered as posed" after the adversarial run classified a negative
 * altitude as out of domain; added explicit unit-conversion and
 * significant-figure rules.
 *
 * v3 (2026-09-30, from docs/failure-modes.md): the three remaining adversarial
 * failures all had one cause — the planner flagged the defect in
 * missing_information and the synthesiser answered anyway with a caveat. Worst
 * case: asked for "the Hohmann transfer delta-v" with no orbits given, it
 * invented 300 km -> 35,786 km, answered, and described those altitudes as
 * "provided". v3 enumerates the four insufficient_data cases, distinguishes a
 * nameable domain convention (km, Earth) from an invented value, and forbids
 * calling an assumed value "provided".
 */
export const PROMPT_VERSION = "agent-v3";

/**
 * Model used for all three agent phases.
 *
 * Configurable because Week 6's controlled experiment varies exactly one
 * variable, and because Gemini's free tier caps `generateContent` at 20
 * requests/day **per model** — an eval run of 60 questions needs more than one
 * model's allowance. The default matches the rest of the API.
 */
export const DEFAULT_AGENT_MODEL = "gemini-3.5-flash";

export const AGENT_MODEL: string =
  process.env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;

export interface AgentStep {
  step: number;
  description: string;
  formula?: string;
  substitution?: string;
  result?: string;
  /** Which tool produced this step's numbers, if any. */
  tool?: string;
}

export interface AgentCitation {
  /** Tool that produced the fact. */
  tool: string;
  /** Where the tool got it (e.g. "NASA APOD, 2026-09-30"). */
  source: string;
  /** The specific value or statement being cited. */
  detail: string;
}

export interface AgentQuantity {
  quantity: string;
  value: number;
  unit: string;
}

export type AgentStatus =
  "answered" | "insufficient_data" | "refused" | "rejected" | "error";

export interface AgentAnswer {
  status: Exclude<AgentStatus, "rejected" | "error">;
  steps: AgentStep[];
  formulas: string[];
  citations: AgentCitation[];
  quantities: AgentQuantity[];
  final_answer: string;
  caveats?: string[];
}

export interface AgentPlan {
  in_domain: boolean;
  domain_reason: string;
  restated_problem: string;
  steps: string[];
  tools_expected: string[];
  missing_information: string[];
}

/** One entry in the inspectable trace. */
export type TraceEntry =
  | {
      type: "guardrail";
      name: string;
      detail: string;
      at: string;
    }
  | {
      type: "plan";
      model: string;
      prompt_version: string;
      plan: AgentPlan;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      at: string;
    }
  | {
      type: "tool_call";
      iteration: number;
      tool: string;
      /** Arguments exactly as the model emitted them. */
      raw_args: Record<string, unknown>;
      /** Arguments after coercion and Zod parsing, when validation passed. */
      validated_args?: unknown;
      coercions?: string[];
      ok: boolean;
      result?: unknown;
      error?: string;
      error_kind?: string;
      attempts: number;
      duration_ms: number;
      at: string;
    }
  | {
      type: "tool_round";
      iteration: number;
      model: string;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      /** How many tool calls this round asked for; 0 means the model was done. */
      calls_requested: number;
      at: string;
    }
  | {
      type: "synthesis";
      model: string;
      prompt_version: string;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      ungrounded_values: number[];
      at: string;
    };

export interface AgentMeta {
  model: string;
  prompt_version: string;
  iterations: number;
  tool_calls: number;
  tool_failures: number;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  /** Names of guardrails that fired, e.g. "iteration_cap", "injection:problem". */
  guardrails_triggered: string[];
}

export interface AgentResult {
  request_id: string;
  status: AgentStatus;
  answer: AgentAnswer;
  plan: AgentPlan | null;
  trace: TraceEntry[];
  meta: AgentMeta;
}

// ---------- Gemini response schemas ----------

export const PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    in_domain: {
      type: Type.BOOLEAN,
      description:
        "True only if the request is about space physics, orbital mechanics, astronomy, spacecraft engineering, or the NASA/ISS data this system can fetch.",
    },
    domain_reason: {
      type: Type.STRING,
      description:
        "One sentence. If out of domain, say what the request is about and what this system does instead.",
    },
    restated_problem: {
      type: Type.STRING,
      description: "The problem restated with explicit quantities and units.",
    },
    steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "The intended solution steps, in order, before any tool is called.",
    },
    tools_expected: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Names of the tools expected to be needed.",
    },
    missing_information: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Quantities or choices the problem does not specify and that cannot be assumed safely. Empty if none.",
    },
  },
  required: [
    "in_domain",
    "domain_reason",
    "restated_problem",
    "steps",
    "tools_expected",
    "missing_information",
  ],
};

export const ANSWER_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ["answered", "insufficient_data", "refused"],
      description:
        "'answered' when the question is fully resolved; 'insufficient_data' when a required input or a failed tool prevents an answer; 'refused' when the request is out of domain.",
    },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          step: { type: Type.INTEGER },
          description: { type: Type.STRING },
          formula: {
            type: Type.STRING,
            description: "The governing formula, as returned by the tool.",
          },
          substitution: {
            type: Type.STRING,
            description: "Numbers substituted into the formula, with units.",
          },
          result: {
            type: Type.STRING,
            description: "This step's result, with units.",
          },
          tool: {
            type: Type.STRING,
            description: "Tool that produced this step's numbers, if any.",
          },
        },
        required: ["step", "description"],
      },
    },
    formulas: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Every formula used, exactly as the tools reported it.",
    },
    citations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tool: { type: Type.STRING },
          source: { type: Type.STRING },
          detail: { type: Type.STRING },
        },
        required: ["tool", "source", "detail"],
      },
      description:
        "One entry per tool-derived fact used in the answer. Never cite a tool that was not called.",
    },
    quantities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          quantity: { type: Type.STRING },
          value: { type: Type.NUMBER },
          unit: { type: Type.STRING },
        },
        required: ["quantity", "value", "unit"],
      },
      description:
        "Every numeric result, with its unit. Values must come from tool results.",
    },
    final_answer: {
      type: Type.STRING,
      description:
        "The answer in prose, with units. If status is not 'answered', state plainly what is missing or why the request was refused.",
    },
    caveats: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Assumptions, staleness or accuracy limits a reader should know.",
    },
  },
  required: [
    "status",
    "steps",
    "formulas",
    "citations",
    "quantities",
    "final_answer",
  ],
};

/** A contract-shaped answer for paths that never reach the model. */
export function nonAnswer(
  status: Exclude<AgentStatus, "rejected" | "error">,
  message: string,
): AgentAnswer {
  return {
    status,
    steps: [],
    formulas: [],
    citations: [],
    quantities: [],
    final_answer: message,
  };
}
