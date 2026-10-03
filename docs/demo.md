# Demo — 3 Minutes

A runnable script, not a slide deck. Every command here has been executed; the
outputs quoted are real.

## Before you start (5 minutes, once)

```bash
# 1 · science service
cd science && ./.venv/bin/uvicorn main:app --port 8000 &

# 2 · API — needs GEMINI_API_KEY and SCIENCE_URL in api/.env
cd api && npm run dev &

# 3 · web (only for the UI beats)
cd web && npm run dev &
```

**Check your model quota first.** The free tier allows 20 `generateContent`
requests per day per model and the demo spends ~6. If the agent returns
`status: "error"` with a 429, switch models:

```bash
export AGENT_MODEL=gemini-3.6-flash   # or 3.1-flash-lite, 3-flash-preview
```

Dry-run the agent beat once before presenting. It takes 13–45 s depending on the
model, which is a long silence if you are not expecting it.

---

## Beat 1 · The agent solves a physics problem (60 s)

Open the **Agent Solver** tab, click the first example, and run it:

> *"Calculate the orbital period of a satellite at 400 km and tell me when the
> ISS next passes over Toronto"*

**Say while it runs** — the wait is the point, use it:

> "Two questions in one sentence. It has to pick two different tools, and it has
> to know it needs both. While that happens: notice the model isn't doing the
> physics. It decides *what* to compute. A Python engine computes it."

**Real output:**

```
The orbital period of a satellite at an altitude of 400 km is approximately
5553.62 seconds (92.56 minutes). The next pass of the ISS over Toronto is
predicted to rise on 2026-10-01 at 00:05:41 UTC, reaching a peak elevation of
12.5 degrees at 00:07:11 UTC, and setting at 00:08:43 UTC.
```

Point at the **quantities** tiles — every number carries its unit — and at the
**caveat**:

> "It volunteered that the ISS prediction comes from a TLE with epoch
> 26273.46514106, and that drag and station-keeping move the real pass. It wasn't
> asked to say that."

## Beat 2 · The trace (45 s)

Expand **Agent trace**. This is the beat that distinguishes the project.

> "Plan, two tool calls, synthesis. Here are the exact arguments the model chose —
> `operation: period, altitude_km: 400` — and the exact result the engine
> returned. 92.56 minutes isn't the model's opinion, it's `T = 2π√(a³/μ)`
> evaluated in Python, and that formula string came back from the engine too."

Click a tool call open to show the raw result. Then:

> "Every model call has its own latency here. Plan 13 seconds, tools 36
> *milliseconds*, synthesis 38 seconds. The physics is free. The LLM is the entire
> latency budget — which is why the load test concluded that optimising the API
> layer would be optimising 0.06% of a request."

**CLI alternative** if the UI is unavailable:

```bash
cd api && npx tsx scripts/agent-cli.ts "Calculate the orbital period of a \
  satellite at 400 km and tell me when the ISS next passes over Toronto"
```

## Beat 3 · A paper question with a page citation (45 s)

**RAG Workspace** tab. Have `2609.24534v1.pdf` (FACSAT-2 orbital decay) already
ingested — ingestion takes ~3 s but costs embedding quota, so pre-load it.

Ask:

> *"Which atmospheric density model did the authors use?"*

**Real output:**

```
The authors used the NRLMSISE-00 atmospheric density model to compute
thermospheric density and reconstruct the orbital evolution of FACSAT-2.

  p.3  [3.1. Atmospheric density]
       "The thermospheric density was computed with NRLMSISE-00 (Picone et al.,
        2002) through the Python package pymsi…"
```

> "Page 3, section 3.1, with the verbatim sentence. And that page number isn't
> taken on trust — the code checks the cited page falls inside the retrieved
> chunk's real page range. A model that cites page 12 for a chunk spanning page 3
> gets that citation dropped, and an answer with no surviving citation is
> downgraded to a refusal."

Expand **retrieval detail** to show hybrid retrieval, `top_k=6`, and the fused
scores.

## Beat 4 · The refusal (20 s)

Same paper, ask something it cannot answer:

> *"What was the total contract cost of the FACSAT-2 launch in US dollars?"*

**Real output:**

```
This paper does not provide enough information to answer that.
  The provided excerpts do not contain information regarding the financial cost
  of the FACSAT-2 launch.
```

> "That's the behaviour the whole feature exists for. The model knows plenty about
> satellite costs. It has nothing from *this* paper, so it says so. Five of the 28
> evaluation questions are deliberately unanswerable, and all four in the last run
> were refused."

## Beat 5 · The evaluation report (30 s)

Switch to a terminal:

```bash
cat docs/eval-history.md | head -24
```

```
v0.6
Physics accuracy    : 100%   (3/3 graded, 2 of 6 not reached — model quota)
Retrieval hit-rate  :  96%   (22/23, hybrid, top_k=6, full gold set)
Refusal accuracy    : 100%   (4/4 unanswerable correctly refused)
Faithfulness        : 100%   (judge-v1, 5 answers)
Citation correctness: 100%   (judge-v1) · 5/5 cited a gold page (deterministic)
```

> "Sixty physics questions whose expected answers are *computed* by the same
> engine the agent calls — so a disagreement is unambiguously the model's. The
> small denominators are the free tier: 20 requests per day per model, three per
> agent run. I'd rather show 3/3 with the denominator than round it up."

**If you have 20 seconds more, this is the strongest thing to say:**

> "The harness caught a failure review wouldn't. Asked for 'the Hohmann transfer
> delta-v' with no orbits given, the agent invented 300 km to GEO, answered
> 3.89 km/s, and described those altitudes as *provided*. Arithmetically correct,
> honest-sounding caveat, completely wrong behaviour. That's prompt version
> `agent-v3` in the history table."

---

## If something breaks

| Symptom | Cause | Say / do |
|---|---|---|
| Agent returns `status: "error"` | daily model quota | "That's the free tier — 20 requests a day per model." Switch `AGENT_MODEL`, or fall back to `docs/failure-modes.md` which has 18 recorded runs. |
| Agent takes >60 s | model demand spike | Let it run; the retry with backoff is visible in the trace. One measured outlier was 228 s. |
| `science service unreachable` | uvicorn not running | Start it. Then point out the agent reported `insufficient_data` and invented nothing — that is adversarial case F1. |
| Paper upload fails | embedding rate limit (100/min) | Use a pre-ingested paper. |
| Nothing works at all | — | `docs/failure-modes.md` and `docs/load-test.md` are the demo: every number in them is a recorded run. |

## Pre-ingesting a paper

```bash
cd evals/papers
curl -sL -o 2609.24534v1.pdf "https://arxiv.org/pdf/2609.24534v1"
# then upload it through the RAG Workspace tab, or:
cd ../../api && npx tsx scripts/rag-e2e.ts ../evals/papers/2609.24534v1.pdf \
  "Which atmospheric density model did the authors use?"
```
