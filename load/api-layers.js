/**
 * Decompose the API layer's latency, so the bottleneck is measured and not guessed.
 *
 * The calculator through the API measured ~10.4ms p50 while the science service
 * alone measured ~1.6ms. This splits the ~8.8ms difference across the layers that
 * could own it:
 *
 *   /health                     Express only — no auth, no rate limit, no science
 *   /                           same, different handler
 *   /api/calculate/period       auth + rate limit + Zod + science hop (the full path)
 *
 * Comparing group medians attributes the cost without guessing. Project
 * principle: do NOT assume the bottleneck before measuring it.
 *
 *   k6 run load/api-layers.js
 */
import http from "k6/http";
import { check, group } from "k6";

const API_URL = __ENV.API_URL || "http://localhost:3101";
const TOKEN = __ENV.TOKEN || "";

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RPS || 20),
      timeUnit: "1s",
      duration: __ENV.DURATION || "45s",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
  },
};

const BODY = JSON.stringify({ altitude_km: 400 });
const AUTHED = {
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
};

export default function () {
  group("express-only", () => {
    const res = http.get(`${API_URL}/health`, { tags: { layer: "express" } });
    check(res, { "health 200": (r) => r.status === 200 });
  });

  group("auth-rejected", () => {
    // No token: measures everything up to and including the auth decision,
    // without the science hop. The gap to `express-only` is the auth path's
    // fixed cost on the rejection branch.
    const res = http.post(`${API_URL}/api/calculate/period`, BODY, {
      headers: { "Content-Type": "application/json" },
      tags: { layer: "auth_reject" },
    });
    check(res, { "unauthorized 401": (r) => r.status === 401 });
  });

  group("full-path", () => {
    const res = http.post(`${API_URL}/api/calculate/period`, BODY, {
      ...AUTHED,
      tags: { layer: "full" },
    });
    check(res, { "calculate 200": (r) => r.status === 200 });
  });
}
