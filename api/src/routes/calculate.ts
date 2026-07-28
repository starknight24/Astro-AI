import { Router, type Request, type Response } from "express";
import { z, type ZodType } from "zod";
import { postToScience } from "../lib/scienceClient";

const SCIENCE_URL = process.env.SCIENCE_URL;
if (!SCIENCE_URL) {
  throw new Error(
    "SCIENCE_URL is required. Set it in api/.env for local dev and in the production environment settings.",
  );
}
const SCIENCE_BASE: string = SCIENCE_URL.replace(/\/+$/, "");

const AltitudeSchema = z.object({
  altitude_km: z.number().finite(),
});

const VisVivaSchema = z.object({
  altitude_km: z.number().finite(),
  semi_major_axis_km: z.number().finite(),
});

const EnergySchema = z.object({
  semi_major_axis_km: z.number().finite(),
});

const HohmannSchema = z.object({
  alt1_km: z.number().finite(),
  alt2_km: z.number().finite(),
});

function forward<T>(sciencePath: string, schema: ZodType<T>) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
      return;
    }
    const outcome = await postToScience(SCIENCE_BASE, sciencePath, parsed.data);
    if (outcome.kind === "network") {
      console.error(`science ${sciencePath} network error:`, outcome.message);
      res.status(502).json({ error: "Science service is unavailable." });
      return;
    }
    res.status(outcome.status).json(outcome.body);
  };
}

const router: Router = Router();

router.post("/period", forward("/calculate/period", AltitudeSchema));
router.post("/velocity", forward("/calculate/velocity", AltitudeSchema));
router.post(
  "/escape-velocity",
  forward("/calculate/escape-velocity", AltitudeSchema),
);
router.post("/vis-viva", forward("/calculate/vis-viva", VisVivaSchema));
router.post("/energy", forward("/calculate/energy", EnergySchema));
router.post("/hohmann", forward("/calculate/hohmann", HohmannSchema));

export default router;
