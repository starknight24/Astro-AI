/**
 * Agent load test: the full plan -> tools -> synthesize loop.
 *
 * Deliberately tiny. Each request costs three model calls against a free tier
 * that allows 20 per day per model, and the Week-7 rate limit allows 10 agent
 * requests per hour per user. A 50-VU run would exhaust both in seconds and then
 * measure nothing but 429s.
 *
 * What this CAN establish is where the time goes under light concurrency, which
 * is the question worth asking when one request already takes tens of seconds.
 *
 *   k6 run load/agent.js
 *   k6 run -e VUS=3 -e DURATION=5m load/agent.js
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const API_URL = __ENV.API_URL || "http://localhost:3001";
const TOKEN = __ENV.TOKEN || "";

const rateLimited = new Counter("rate_limited_429");
const answered = new Counter("agent_answered");
const refused = new Counter("agent_refused");
const toolCalls = new Trend("agent_tool_calls");
const agentDuration = new Trend("agent_duration_ms", true);

export const options = {
  scenarios: {
    light: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 2),
      duration: __ENV.DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: false }],
    // Three model calls per request. The measured floor is tens of seconds, so a
    // threshold near a second would just always fail and tell us nothing.
    "http_req_duration{expected_response:true}": ["p(95)<180000"],
  },
};

const PROBLEMS = [
  "What is the orbital period in minutes of a satellite in a circular orbit at 400 km altitude?",
  "What is the escape velocity in km/s from an altitude of 600 km above Earth's surface?",
  "What is the total delta-v in km/s for a Hohmann transfer from 300 km to 35786 km altitude?",
  "What is the orbital speed in km/s at an altitude of 800 km?",
];

export default function () {
  const problem = PROBLEMS[Math.floor(Math.random() * PROBLEMS.length)];
  const res = http.post(`${API_URL}/api/agent/solve`, JSON.stringify({ problem }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    timeout: "240s",
    tags: { name: "agent/solve" },
  });

  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }

  check(res, {
    "status is 200": (r) => r.status === 200,
    "produced a contract-shaped answer": (r) => {
      if (r.status !== 200) return false;
      try {
        const body = r.json();
        agentDuration.add(body.meta.duration_ms);
        toolCalls.add(body.meta.tool_calls);
        if (body.status === "answered") answered.add(1);
        if (body.status === "refused") refused.add(1);
        return Array.isArray(body.trace) && typeof body.answer.final_answer === "string";
      } catch {
        return false;
      }
    },
  });
}
