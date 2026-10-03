/**
 * Calculator load test: the deterministic path, no LLM.
 *
 * This is the only endpoint in the system that can be pushed hard — the physics
 * is microseconds of CPU and its only dependency is the science service, so what
 * this measures is our own code and the api->science HTTP hop that ADR-001
 * accepted as a cost and ADR-003 put "on the measurement docket".
 *
 *   k6 run load/calculator.js
 *   k6 run -e MAX_RPS=100 load/calculator.js
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const API_URL = __ENV.API_URL || "http://localhost:3001";
const TOKEN = __ENV.TOKEN || "";
const MAX_RPS = Number(__ENV.MAX_RPS || 50);

const rateLimited = new Counter("rate_limited_429");
// Not a duration: this is the orbital period the engine returned, tracked only
// to prove the engine kept answering correctly under load.
const enginePeriod = new Trend("engine_period_seconds");

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 5, duration: "20s" },          // warm up, let caches fill
        { target: MAX_RPS, duration: "40s" },    // ramp
        { target: MAX_RPS, duration: "60s" },    // hold — percentiles come from here
        { target: 0, duration: "10s" },
      ],
    },
  },
  thresholds: {
    // The exit criterion: survive the scenario without a 5xx storm.
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
    // Deterministic maths behind one HTTP hop; anything near a second is a bug.
    "http_req_duration{expected_response:true}": ["p(95)<800", "p(99)<1500"],
  },
};

// A spread of altitudes so the response cache (if one is ever added here) cannot
// make the test meaningless.
const ALTITUDES = [200, 350, 400, 420, 550, 700, 800, 1000, 2000, 35786];

export default function () {
  const altitude = ALTITUDES[Math.floor(Math.random() * ALTITUDES.length)];
  const res = http.post(
    `${API_URL}/api/calculate/period`,
    JSON.stringify({ altitude_km: altitude }),
    {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      tags: { name: "calculate/period" },
    },
  );

  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }

  check(res, {
    "status is 200": (r) => r.status === 200,
    // Correctness under load, not just liveness: a fast wrong answer is worse
    // than a slow right one.
    "period is right for the altitude": (r) => {
      if (r.status !== 200) return false;
      try {
        const body = r.json();
        const a = 6378.137 + altitude;
        const expected = 2 * Math.PI * Math.sqrt((a * a * a) / 398600.4418);
        enginePeriod.add(body.period_s);
        return Math.abs(body.period_s - expected) / expected < 1e-6;
      } catch {
        return false;
      }
    },
  });
}
