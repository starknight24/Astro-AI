/**
 * Agent guardrails: limits, injection defence, and argument hygiene.
 *
 * Design notes (ADR-005):
 *  - Limits are constants in one place so the eval harness can read them.
 *  - Prompt-injection defence is *layered*, not a regex that claims to be a
 *    solution: user text and tool output are always framed as data, the model is
 *    told so, imperative directives found inside them are redacted before they
 *    reach the model, and every redaction is recorded in the trace so a
 *    suspicious answer can be traced back to the text that caused it.
 *  - Nothing here can grant a tool call. Tools are only reachable through the
 *    Zod-validated registry, so the worst a successful injection achieves is a
 *    bad *answer*, never an unintended side effect.
 */

/** Hard ceiling on tool-calling rounds. Week-4 requirement. */
export const MAX_TOOL_ITERATIONS = 6;

/** Ceiling on tool calls overall, since one round may request several. */
export const MAX_TOOL_CALLS = 10;

/** Longest problem statement accepted. Beyond this the request is rejected. */
export const MAX_PROBLEM_CHARS = 4000;

/** Tool output is truncated before it is shown to the model. */
export const MAX_TOOL_RESULT_CHARS = 6000;

/** Whole-request budget, independent of per-tool timeouts. */
export const AGENT_DEADLINE_MS = 90_000;

/**
 * Imperative patterns that have no business appearing in a physics problem or
 * in NASA/paper content. Matches are redacted, not silently dropped, so the
 * model still sees that *something* was removed and the trace records what.
 */
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "ignore-previous",
    re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,40}\b(?:instruction|prompt|rule|direction|context)s?\b/gi,
  },
  {
    name: "role-reassignment",
    re: /\b(?:you are|you're|act as|pretend to be|behave as|roleplay as)\b[^.\n]{0,60}\b(?:now|instead|no longer)\b/gi,
  },
  {
    name: "system-prompt-spoof",
    re: /(?:^|\n)\s*(?:system|assistant|developer)\s*(?::|>)\s*/gi,
  },
  {
    name: "instruction-tag-spoof",
    re: /<\/?(?:system|instruction|prompt|admin)[^>]{0,40}>/gi,
  },
  {
    name: "reveal-secrets",
    re: /\b(?:reveal|print|show|output|repeat|leak|dump)\b[^.\n]{0,40}\b(?:system prompt|instructions|api[- ]?key|secret|token|env(?:ironment)? variable|credential)s?\b/gi,
  },
  {
    name: "guardrail-bypass",
    re: /\b(?:bypass|disable|turn off|skip|circumvent)\b[^.\n]{0,40}\b(?:guardrail|safety|filter|validation|restriction|limit)s?\b/gi,
  },
  {
    name: "tool-command-injection",
    re: /\b(?:call|invoke|run|execute)\b[^.\n]{0,30}\b(?:tool|function|command|shell|bash|sql)\b[^.\n]{0,40}\b(?:with|as|using)\b/gi,
  },
  {
    name: "fabricate-citation",
    re: /\b(?:make up|fabricate|invent|pretend)\b[^.\n]{0,40}\b(?:citation|source|page|result|number|data)s?\b/gi,
  },
];

export interface ScrubResult {
  /** Text safe to place inside a data block. */
  text: string;
  /** Names of the patterns that fired, de-duplicated. */
  flagged: string[];
  /** The literal snippets that were redacted, capped for log hygiene. */
  redactions: string[];
}

const REDACTION_MARKER =
  "[redacted: instruction-like text removed by guardrail]";

/**
 * Neutralise instruction-like content in untrusted text.
 * `label` names the origin (e.g. "problem", "tool:apod") for the trace.
 */
export function scrubUntrusted(text: string, label: string): ScrubResult {
  const flagged = new Set<string>();
  const redactions: string[] = [];
  let out = text;

  for (const { name, re } of INJECTION_PATTERNS) {
    out = out.replace(re, (match) => {
      flagged.add(name);
      if (redactions.length < 10)
        redactions.push(`${label}:${name}:${match.slice(0, 120)}`);
      return REDACTION_MARKER;
    });
  }
  // Collapse fenced-block markers that could break out of our data delimiters.
  out = out.replace(/```/g, "'''");
  return { text: out, flagged: [...flagged], redactions };
}

/** Wrap untrusted text in delimiters that label it as data, never instructions. */
export function asDataBlock(label: string, text: string): string {
  return `<untrusted-${label}>\n${text}\n</untrusted-${label}>`;
}

export interface ProblemCheck {
  ok: boolean;
  /** Why the request was rejected before any model call. */
  reason?: string;
}

/**
 * Cheap pre-model checks. Deliberately only rejects what is objectively
 * unusable (empty, oversized): deciding whether a *topic* is in domain needs
 * judgement and is the planner's job, not a keyword list's.
 */
export function checkProblem(problem: unknown): ProblemCheck {
  if (typeof problem !== "string" || problem.trim().length === 0) {
    return { ok: false, reason: "A non-empty 'problem' string is required." };
  }
  if (problem.length > MAX_PROBLEM_CHARS) {
    return {
      ok: false,
      reason: `Problem statement is ${problem.length} characters; the limit is ${MAX_PROBLEM_CHARS}.`,
    };
  }
  return { ok: true };
}

/** Truncate tool output shown to the model, marking that it was cut. */
export function truncateForModel(value: unknown): {
  text: string;
  truncated: boolean;
} {
  const json = JSON.stringify(value, null, 1) ?? "null";
  if (json.length <= MAX_TOOL_RESULT_CHARS)
    return { text: json, truncated: false };
  return {
    text: `${json.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated ${json.length - MAX_TOOL_RESULT_CHARS} chars]`,
    truncated: true,
  };
}

/**
 * Coerce the argument shapes models actually emit into the shapes Zod expects.
 *
 * Only unambiguous repairs: "400" and "400 km" become 400, "true" becomes true,
 * empty strings become undefined. Anything ambiguous ("a few hundred km") is
 * left alone so validation fails loudly and the model is told to fix it, rather
 * than the agent inventing a number.
 */
export function coerceArgs(args: Record<string, unknown>): {
  args: Record<string, unknown>;
  coercions: string[];
} {
  const coercions: string[] = [];
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(args)) {
    if (typeof raw !== "string") {
      out[key] = raw;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      coercions.push(`${key}: empty string dropped`);
      continue;
    }
    if (/^(true|false)$/i.test(trimmed)) {
      out[key] = trimmed.toLowerCase() === "true";
      coercions.push(`${key}: "${raw}" -> ${out[key]}`);
      continue;
    }
    // "400", "400.5", "-3", "1e3", optionally followed by a unit we already require.
    const numeric = trimmed.match(
      /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(km|m|s|min|deg|°|days?)?$/,
    );
    if (numeric && key !== "place" && key !== "asteroid_id") {
      out[key] = Number(numeric[1]);
      if (numeric[2])
        coercions.push(
          `${key}: "${raw}" -> ${out[key]} (unit suffix dropped; schema unit assumed)`,
        );
      else coercions.push(`${key}: "${raw}" -> ${out[key]}`);
      continue;
    }
    out[key] = raw;
  }
  return { args: out, coercions };
}

/**
 * Advisory check that the numbers in a synthesized answer came from tools.
 *
 * Principle: the physics engine is ground truth and the model only explains, so
 * every quantity should be traceable to a tool result. Common unit conversions
 * are accepted because the answer is allowed to present minutes when the tool
 * returned seconds. Unmatched values are reported, not blocked — the check is
 * advisory and its false positives (a student-supplied input echoed back, a
 * rounded intermediate) belong in the trace, not in a hard failure.
 */
const CONVERSION_FACTORS = [
  1,
  60,
  1 / 60,
  3600,
  1 / 3600,
  1000,
  1 / 1000,
  24,
  1 / 24,
];

export function verifyNumericGrounding(
  values: number[],
  toolResults: unknown[],
  relativeTolerance = 0.01,
): { grounded: number[]; ungrounded: number[] } {
  const pool = new Set<number>();
  const collect = (node: unknown): void => {
    if (typeof node === "number" && Number.isFinite(node)) {
      pool.add(node);
    } else if (typeof node === "string") {
      const n = Number(node);
      if (node.trim() !== "" && Number.isFinite(n)) pool.add(n);
    } else if (Array.isArray(node)) {
      node.forEach(collect);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(collect);
    }
  };
  toolResults.forEach(collect);

  const grounded: number[] = [];
  const ungrounded: number[] = [];
  for (const value of values) {
    const matched = [...pool].some((candidate) =>
      CONVERSION_FACTORS.some((f) => {
        const scaled = candidate * f;
        const tol = Math.max(Math.abs(scaled) * relativeTolerance, 1e-9);
        return Math.abs(scaled - value) <= tol;
      }),
    );
    (matched ? grounded : ungrounded).push(value);
  }
  return { grounded, ungrounded };
}
