import { describe, expect, it } from "vitest";
import {
  ANSWER_SCHEMA,
  DEFAULT_AGENT_MODEL,
  PLAN_SCHEMA,
  PROMPT_VERSION,
  nonAnswer,
} from "./contract";

describe("output contract", () => {
  it("requires all five contract parts of the model", () => {
    expect(ANSWER_SCHEMA.required).toEqual([
      "status",
      "steps",
      "formulas",
      "citations",
      "quantities",
      "final_answer",
    ]);
  });

  it("constrains status to the three answer outcomes", () => {
    expect(ANSWER_SCHEMA.properties?.status.enum).toEqual([
      "answered",
      "insufficient_data",
      "refused",
    ]);
  });

  it("requires a unit on every quantity", () => {
    expect(ANSWER_SCHEMA.properties?.quantities.items?.required).toEqual([
      "quantity",
      "value",
      "unit",
    ]);
  });

  it("requires tool, source and detail on every citation", () => {
    expect(ANSWER_SCHEMA.properties?.citations.items?.required).toEqual([
      "tool",
      "source",
      "detail",
    ]);
  });

  it("makes the planner commit to an in-domain verdict and missing information", () => {
    expect(PLAN_SCHEMA.required).toContain("in_domain");
    expect(PLAN_SCHEMA.required).toContain("missing_information");
  });

  it("defaults to the model the rest of the API uses", () => {
    expect(DEFAULT_AGENT_MODEL).toBe("gemini-3.5-flash");
  });

  it("versions the prompts so traces stay comparable", () => {
    expect(PROMPT_VERSION).toBe("agent-v3");
  });

  it("builds a contract-shaped non-answer for paths that never reach the model", () => {
    const answer = nonAnswer("insufficient_data", "nope");
    expect(answer).toEqual({
      status: "insufficient_data",
      steps: [],
      formulas: [],
      citations: [],
      quantities: [],
      final_answer: "nope",
    });
  });
});
