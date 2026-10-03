# Walkthrough Talking Points

Two versions. Both are **talking points, not a script** — the aim is that you can
say these things from memory, in your own words, because an answer you can
reconstruct from the architecture is worth more than one you can recite.

Rule for both: **every number comes with its denominator.** "100% on three graded
cases" is more credible than "100%", and the interviewer will respect it more.

---

# 3 minutes

## Problem (20 s)

> "Engineering students need orbital-mechanics answers that are *correct* and
> claims they can *check*. An LLM gives you neither — it's confidently wrong at
> arithmetic, and it will invent a page number in the same tone it uses for a real
> one. So the question I set myself was: can you make a probabilistic system
> trustworthy by making a deterministic one responsible for every fact it asserts
> — and then prove it with measurements?"

## Architecture (30 s)

> "Three services. A React SPA, an Express API that's the only public entry point,
> and a Python science service for the things Python is better at — orbital
> mechanics, SGP4 propagation, PDF extraction. Auth, validation, rate limiting and
> every secret live at the API boundary; the browser never holds a key and never
> touches Postgres."

## The agent (45 s)

> "The agent is hand-written, three phases: plan, tool loop, synthesize. The
> planning call has *no tools* — it produces a written plan and an in-domain
> verdict, so an out-of-domain request is refused before any budget is spent. The
> tool loop is capped at six rounds and ten calls, every argument is Zod-validated,
> every tool has a timeout that's *raced* against the executor rather than relying
> on an abort signal, and transient failures get backoff. Then a separate synthesis
> call that has no tool access at all — which is what guarantees it can't quietly
> recompute a number."
>
> "Four tools. The physics one is a pass-through to Python. ISS passes come from
> Celestrak TLEs propagated with SGP4 — I checked that against an independent SGP4
> service and matched to 0.1 km, and I found Open Notify was serving positions 29
> minutes stale, which is 13,000 kilometres."

## RAG (30 s)

> "PDF to cited answer. The interesting part is that citations are verified in
> *code*: the model returns a chunk index and a page, and I check the chunk was
> retrieved in that request and the page falls inside that chunk's real page range.
> Invalid citations get dropped, and an answer with none left is downgraded to a
> refusal. So 'citations are real' is a property of the system, not a hope about
> the prompt."
>
> "Chunking is section-aware for the same reason — a chunk is the thing a page
> number points at, so if a chunk straddles two sections the citation is ambiguous."

## Evaluation (40 s)

> "Sixty physics questions whose expected answers are *computed* by the same engine
> the agent calls. That's the whole thesis: the grader is deterministic, so a
> disagreement is unambiguously the model's. Last run: 100% on three graded cases —
> small because the free tier allows 20 model requests a day per model and one agent
> run costs three."
>
> "Retrieval hit-rate is 96% on the full 23-case set — that one I can run freely
> because it only needs embeddings, no model calls. Faithfulness and citation
> correctness 100% from a versioned LLM judge, alongside a deterministic check that
> the cited page was a gold page."
>
> "And I ran a controlled experiment: hybrid retrieval versus vector-only, one
> variable. 95.7% against 91.3%. Hybrid fixed one case and broke none, so it stays
> on."

## Results (15 s)

> "Load test: 4,449 requests through the calculator, zero 5xx, p50 10 milliseconds,
> and every response checked against the closed-form period. The finding that
> mattered, though, was that the API layer is 8.8 milliseconds of a 13-second agent
> request. The latency is three LLM calls. Nothing in my infrastructure moves it."

---

# 10 minutes

Same spine, more depth. The extra time goes into §3 and §4 — the hardest decision
and what broke — because that is what distinguishes this from a tutorial project.

## 1 · Problem and thesis (45 s)

As above, plus:

> "I wanted the product requirement and the engineering requirement to be the same
> thing. 'Don't hallucinate a number' is a user need *and* a testable property, so
> the whole design falls out of taking it literally."

## 2 · Architecture from memory (90 s)

Draw it. SPA → API → three dependencies and one internal service.

> "Three packages, one repo. The API is the only public entry point: auth, Zod
> validation, rate limiting, idempotency, and every secret. The science service is
> internal — Python, because SGP4, NumPy and PyMuPDF have no serious Node
> equivalent, and because the eval harness is Python and imports the physics engine
> directly with nothing in between."
>
> "Fourteen tables. The one I'd point at is `agent_traces`: one row per LLM call,
> rows sharing a `request_id`, and deliberately *no* foreign keys so a request that
> fails before it ever touches the users table still records. And deliberately no
> prompt text — token counts and latency, but not the student's words. Same reason
> Sentry's scrubber strips request bodies: their question is the content of the
> product, not telemetry."
>
> "RLS is on for all fourteen tables with no policies — deny-all through Supabase's
> public API. The browser can't read anything even with the anon key."

## 3 · The hardest engineering decision (2 min 30 s)

Pick one and go deep. The strongest is **how far to trust the model**, because it
recurs at three layers and the answer is different each time.

> "The hardest decision wasn't a technology choice, it was repeatedly deciding how
> much to trust the model — and I got a different answer at each layer.
>
> **Arithmetic: zero trust.** The engine computes, the model explains. That's
> ADR-003 and it's the foundation — a system can't be graded by itself, so I needed
> a source of physics answers the model didn't produce.
>
> **Citations: zero trust, but enforced differently.** I couldn't put page numbers
> behind a deterministic engine, so I verify after the fact. The model returns a
> chunk index and a page; the code checks that chunk was retrieved in *this*
> request and that the page is inside its real range. The nice property is that it
> *can't* cite a page that isn't real, however confident it is.
>
> **Planning and tool choice: full trust, bounded.** I let the model decide which
> tool to call and what to put in the arguments — that judgement is what it's good
> at. But the blast radius is bounded: tools are only reachable through a
> Zod-validated registry, so the worst a bad decision or a successful prompt
> injection produces is a wrong *answer*. Never a shell, never a DB write, never a
> secret — because no secret is ever in its context.
>
> **Domain gating: trust, with a measurement.** 'Is this about space physics?' needs
> judgement — 'why is the ISS at 51.6 degrees' is in domain with no numbers in it,
> and 'calculate the orbital period of my mortgage' is out of domain while
> containing all the right words. So that's a model call, and because it's
> probabilistic I trace every refusal and put refusals in the eval set."

If they push on the framework question:

> "I wrote the loop by hand, about 250 lines. A framework would have shipped in a
> day and given me its opinions about retries and error handling — which are
> exactly the parts worth being able to explain. The cost is real: no multi-agent
> handoff, no streaming tool calls, no community middleware. For four tools that's
> the right trade."

## 4 · What broke (2 min 30 s)

Have three ready. They're different kinds of failure, which is the point.

**(a) The agent answered a question nobody asked.**

> "The adversarial suite asked for 'the Hohmann transfer delta-v' with no orbits
> given. The planner correctly flagged both radii as missing. Then the synthesiser
> invented 300 km to GEO, answered 3.89 km/s, and wrote a caveat saying the radii
> were 'derived from the provided altitudes' — altitudes the user never provided.
>
> Arithmetically correct. Honestly-worded caveat. Completely wrong behaviour, and
> it would have passed any review that read the number instead of the question.
> Two other cases had the same shape: a semi-major axis inside the Earth got
> silently reinterpreted as an altitude, and two contradictory givens got silently
> resolved by picking one.
>
> One root cause: the planner identified the defect and the synthesiser *demoted*
> it from 'can't answer' to 'answer with a footnote'. Fixed in prompt version
> `agent-v3` by enumerating the four cases that must be `insufficient_data` and
> forbidding the model from describing a value it chose as one it was given. Then I
> re-ran and confirmed."

**(b) I almost published noise as a performance improvement.**

> "I found the API layer added 8.8 milliseconds over the engine, decomposed it, and
> discovered JWT verification was 0.05 milliseconds — negligible, and the opposite
> of what I'd have guessed. The real cost was two database round trips per request,
> one of which was an `ON CONFLICT DO NOTHING` upsert that's a no-op after the
> first success. So I memoised it and measured before and after.
>
> The 'after' was *slower*. Including the Express baseline, which I hadn't touched.
> So I ran the same binary three times: the cheap endpoints were stable to 0.1
> milliseconds, but the path that makes network calls varied by 1.8 — twice the
> effect I was trying to measure. I couldn't demonstrate the improvement locally,
> so I don't claim it. What I claim is one fewer database round trip per request,
> proven by a test that asserts 50 requests produce one query. In production that
> round trip is network-bound to Supabase, so the saving is larger there — but I
> say that as reasoning, not as a measurement."

**(c) A retrieval 'miss' was my bad label.**

> "First baseline was 87% hit-rate with three misses. One was 'at what confidence
> level was this detected?', labelled as page 7 — but the 95% figure is stated on
> five pages and the retriever had returned two of them. My label was wrong, not
> the retriever.
>
> The tempting fix is to correct that one label. Instead I wrote down the rule — a
> page is gold if reading that page alone answers the question — and applied it to
> all 23 cases. It narrowed two labels and broadened ten. 87% became 96%, and I
> kept the old row in the history table with a note saying the two aren't
> comparable, because that's a label fix, not an improvement. Corrections in both
> directions is how you can tell it's a rule and not me fitting labels to results."

## 5 · Evaluation (1 min 30 s)

> "Three things measured separately because they fail separately.
>
> Physics has a right answer, so no judgement is needed: 60 questions whose expected
> values are computed by `orbital.py`, graded on a 1% tolerance — tight enough that
> a forgotten Earth radius can't pass, since that turns 92.56 minutes into 4.19,
> loose enough that sensible rounding doesn't fail.
>
> Retrieval has a right answer given labels: is a gold page in the top-k. That one
> needs embeddings but no model calls, so it's free and I run the full set.
>
> Answer quality has no mechanical answer, so there's an LLM judge — versioned
> `judge-v1`, because a judge whose prompt drifts makes two runs incomparable. And
> I'm explicit about its limits: it's the same family of model it's judging, it only
> sees the retrieved excerpts so it can't tell 'correctly refused' from 'retrieval
> failed and the refusal was lucky', and it's not calibrated against human labels.
> Which is why there's a deterministic companion — did the answer cite a gold page —
> and why citations are enforced in code rather than graded."

If asked why the samples are small, don't apologise:

> "The free tier allows 20 generateContent requests per day per model. I measured
> that. One agent run costs three, so a run samples six physics cases. That's a
> real constraint and it's the top item on my future-work list — it limits the
> *evidence*, not the product. I'd rather report 3/3 with the denominator than
> round it up."

## 6 · Performance (1 min)

> "k6: 4,449 calculator requests, zero 5xx, p50 10 milliseconds, p99 16, and every
> response verified against `T = 2π√(a³/μ)` computed in the test — correctness under
> load, not just liveness.
>
> Then the number that reframed everything: the engine is 1.64 milliseconds, the API
> layer 8.8, and one agent request is 13 *seconds*. The API layer is 0.06% of a
> request. So I didn't spend the week tuning Express. The real levers are
> architectural — collapse plan and tools into one model call for a third of the
> latency, stream synthesis so first tokens land in a second instead of thirteen,
> and cache whole answers because a tutoring app asks the same questions. ADR-005
> already has the revisit trigger and the cost: collapsing the phases loses the
> pre-tool refusal."

## 7 · Future work (30 s)

> "In order: a paid API key, because it's the binding constraint on the evidence.
> Two model calls instead of three, measured against the harness. Streaming. Then
> the one open security item — `WEB_ORIGIN` isn't required in production, so a
> misconfigured deploy opens CORS, and I left that for a deliberate deploy rather
> than a deadline. Then semantic chunking, measured against the EXP-001 baseline,
> because the single remaining retrieval miss is a fact buried in a subordinate
> clause and a bigger top-k would trade precision rather than fix it."

---

## Questions to expect, and the honest answer

**"Why not LangChain?"** → §3 last paragraph. The loop is the deliverable.

**"Is 100% real?"** → "On three graded cases, yes. The denominator is in every
number I quote. Retrieval's 96% is on the full 23-case set and that one I trust
more."

**"How do you know the citations are right?"** → "Two ways. The code verifies the
page against the retrieved chunk's real range, so a fabricated page can't be
displayed. And I spot-checked the quotes against the PDFs by hand — they're
verbatim."

**"What would you do differently?"** → "I'd have written ADR-004 when I built auth
instead of reconstructing it in week 8. And I'd have fixed the eval harness's
grading bugs before trusting a run — I had a 503 counted as a physics failure,
which took a 100% run to 0%, and a grader that compared Δv₁ against a total.
Both were my bugs, and both briefly made the system look worse than it was."

**"What's the weakest part?"** → "Sample sizes, caused by the quota. After that,
heading detection — it's heuristic, tuned on five papers, and it will meet a
template that defeats it. It warns when it finds no headings, and chunking still
works with page attribution intact, but section attribution is lost."
