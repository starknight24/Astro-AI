/**
 * The science service on its own, with no API in front of it.
 *
 * Run alongside `calculator.js` at the same arrival rate: the difference between
 * the two is the cost of the API layer — Express, CORS, JWT verification, the
 * rate-limit upsert, Zod, and the api->science HTTP hop.
 *
 * That difference is the number ADR-001 accepted without measuring ("every
 * physics call pays an HTTP hop") and ADR-003 put "on the measurement docket".
 * This is the docket.
 *
 *   k6 run -e MAX_RPS=50 load/science-direct.js
 */
import http from "k6/http";
import { check } from "k6";

const SCIENCE_URL = __ENV.SCIENCE_URL || "http://127.0.0.1:8000";
const MAX_RPS = Number(__ENV.MAX_RPS || 50);

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 5, duration: "20s" },
        { target: MAX_RPS, duration: "40s" },
        { target: MAX_RPS, duration: "60s" },
        { target: 0, duration: "10s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
    // Pure computation behind one FastAPI route.
    "http_req_duration{expected_response:true}": ["p(95)<200", "p(99)<400"],
  },
};

const ALTITUDES = [200, 350, 400, 420, 550, 700, 800, 1000, 2000, 35786];

export default function () {
  const altitude = ALTITUDES[Math.floor(Math.random() * ALTITUDES.length)];
  const res = http.post(
    `${SCIENCE_URL}/calculate/period`,
    JSON.stringify({ altitude_km: altitude }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "science/period" } },
  );
  check(res, { "status is 200": (r) => r.status === 200 });
}
