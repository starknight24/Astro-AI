import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { runAgent } from "../agent/loop";
import { MAX_PROBLEM_CHARS } from "../agent/guardrails";
import { TOOLS } from "../agent/tools";
import { idempotency } from "../middleware/idempotency";

const SolveBody = z.object({
  problem: z
    .string()
    .min(1, "problem must not be empty")
    .max(MAX_PROBLEM_CHARS),
  /** Optional client-supplied id so a retry can be correlated in the traces. */
  request_id: z.string().uuid().optional(),
});

const router: Router = Router();

/**
 * POST /api/agent/solve — the Week-4 agent.
 *
 * Returns the answer contract plus the full trace. The trace is part of the
 * response on purpose: the project's premise is that the agent is inspectable,
 * and a debug-only trace is a trace nobody reads.
 */
router.post(
  "/solve",
  idempotency("POST /api/agent/solve"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SolveBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
      return;
    }

    const requestId = parsed.data.request_id ?? randomUUID();
    try {
      const result = await runAgent({
        problem: parsed.data.problem,
        userId: req.auth?.userId ?? null,
        requestId,
      });
      // "rejected" is a client error; refusals and insufficient data are valid
      // answers the UI renders, so they stay 200.
      res.status(result.status === "rejected" ? 400 : 200).json(result);
    } catch (err) {
      console.error(`[${requestId}] agent route failed:`, err);
      res.status(500).json({
        error: "The agent failed to produce an answer.",
        request_id: requestId,
      });
    }
  },
);

/** GET /api/agent/tools — the tool contract, for the UI and for documentation. */
router.get("/tools", (_req: Request, res: Response): void => {
  res.json({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      timeout_ms: t.timeoutMs,
      retries: t.retries,
      parameters: t.declaration.parameters,
    })),
  });
});

export default router;
