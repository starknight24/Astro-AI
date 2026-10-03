# ADR-007: Evaluation Design

**Status:** Accepted · **Date:** 2026-10-01

## Context

The project's differentiating claim is that a probabilistic system is held to
account by a deterministic one. Weeks 4 and 5 built the probabilistic parts; this
week builds the thing that measures them. Without it, "the agent is accurate" and
"the citations are real" are assertions.

Three things need measuring, and they fail in different ways, so they need
different instruments:

1. **Physics accuracy** — does the agent's number match the engine's? This has a
   right answer, so it needs no judgement at all.
2. **Retrieval quality** — is the page containing the answer actually retrieved?
   This has a right answer too, given labels.
3. **Answer quality** — is the answer faithful to the retrieved text, and does
   each citation point at the right page? This has no mechanical right answer,
   so it needs a judge, with all the caveats that implies.

One constraint shapes the whole design: the Gemini free tier allows **20
`generateContent` requests per day per model**, measured, and one agent run costs
three. A design that needs 300 model calls to produce a number is a design that
produces no number.

## Decision

### 1. Ground truth comes from the engine, never from a person

`evals/build_physics_dataset.py` **computes** all 60 expected answers by importing
`science/orbital.py` and calling the same functions the agent's tool calls. No
expected value is typed in by hand.

This is the whole point of ADR-003 arriving as a measurement rather than a claim.
A hand-written answer key would make the harness grade the model against *my*
arithmetic, and my arithmetic is not the ground truth the product promises. With
the key generated, a disagreement is unambiguously the model's.

The engine is itself validated against outside references — 62 unit tests against
textbook and NASA values, plus the dataset's own spot-checks (ISS period 92.56
min, GEO period 23.934 h, surface escape velocity 11.19 km/s, LEO→GEO Hohmann
3.85 km/s, all within 0.1% of published figures). The chain is therefore:
published reference → engine tests → engine → golden dataset → grade.

Each case records the `derivation` string (`orbital_period(400)['period_min']`)
so a disputed answer can be re-derived without guessing which call produced it.

**Tolerances: 1%, and 2% for Hohmann delta-v.** Not arbitrary. A correct agent
reports what the engine returned, so a passing run matches to many digits; the
tolerance only has to absorb the rounding the model applies when writing prose
("5553.62 s"). 1% is roughly two significant figures of slack — tight enough that
a wrong formula or a forgotten Earth radius cannot slip through (a missing
R_earth turns 92.56 min into 4.19 min), loose enough that sensible rounding does
not fail. Hohmann delta-v gets 2% because it is a difference of two similar
velocities, so the same absolute rounding is a larger relative error.

**Unit confusion is a failure, not a near-miss.** The grader prefers the
`quantities` entry whose unit matches the question's stated unit. Reporting
5553.62 s to a question that asked for minutes fails, even though the digits are
"right" — because for a student it is wrong.

### 2. The dataset covers the ways physics answers go wrong, not just the topics

60 cases across all six engine formulas, three difficulty bands, and some
deliberate traps:

| Trap | Cases | What it catches |
|---|---|---|
| Altitude 0 km | escape velocity at the surface | forgetting that altitude ≠ radius |
| GEO (35,786 km) | period in hours | the sidereal-day sanity check |
| Perigee/apogee given, `a` not | 8 vis-viva cases | failure to derive the semi-major axis first |
| Descending transfer (1000 → 400 km) | Hohmann | sign handling on negative delta-v |
| Near-equal radii (200 → 400 km) | Hohmann | small-difference precision |
| Lunar distance (400 → 384,400 km) | Hohmann | regime far outside LEO |
| Unit conversion in the question | km/h, hours, orbits/day | the agent must convert, not the engine |
| Two engine calls needed | 4 "derived" cases | composing tools, not just calling one |

Every question states its unit explicitly, because ambiguous units are their own
failure mode (documented in `failure-modes.md`) and this set measures physics, not
unit guessing. A test asserts that property for all 60.

### 3. Retrieval is measured without a model in the loop

`--retrieval-only` scores retrieval hit-rate and MRR against gold page labels
using **embeddings only**. No answer generation, no judge, no `generateContent`
quota.

That is a deliberate structural choice, not a convenience. It means the metric
most likely to drive a design change can be re-measured on demand, is free of
sampling noise, and is not rationed. EXP-001 exists because of it.

Hit-rate counts a gold page as retrieved if it falls **anywhere in a returned
chunk's page range**, because chunks cross page breaks and a chunk that contains
the answer has retrieved it regardless of which page the chunk "starts" on.

**MRR as well as hit-rate.** Hit-rate cannot distinguish the gold page at rank 1
from rank 6, and rank matters: the answerer sees a bounded context, so a gold
chunk at rank 6 competes with five distractors.

### 4. Gold labels follow one stated rule, and the rule was tested against reality

**A page is gold iff reading that page alone answers the question.** Labels were
derived by searching the extracted text for the answer string and inspecting each
hit's context — a page where the string appears in a reference list, a figure
caption, or an unrelated role is not gold.

This rule was *corrected into existence* by the first baseline run, and the
episode is worth recording because it is the main methodological risk of
authoring a dataset and measuring with it in the same sitting:

The first run (`rag-golden-v1`) reported **87% hit-rate, 3 misses**. Inspecting
them, `rag-027` (*"At what confidence level was the redshift modulation
detected?"*) was labelled `gold_pages=[7]` — but the 95% confidence level is
stated on **five** pages, and the retriever had returned two of them. **The label
was wrong, not the retriever.**

The temptation is to fix that one label. Instead the rule was applied uniformly
to all 23 answerable cases, which **narrowed 2** labels and **broadened 10**, and
the dataset was versioned `rag-golden-v2` with the rule stored in it. Corrections
in both directions is the check that this was a rule and not result-fitting. The
corrected baseline is 95.7%.

The remaining risk is stated rather than solved: these labels were authored by
the same person who built the retriever, in one session. The mitigations are the
stated rule, the uniform application, the bidirectional corrections, and the fact
that the whole episode is written down here and in EXP-001.

### 5. Refusal is measured deterministically; faithfulness is judged

5 of the 28 RAG cases are **intentionally unanswerable** — facts genuinely absent
from the paper, each verified absent by searching the full text (`why_absent` is
recorded per case: *"'Mbps' and 'downlink' appear nowhere in the paper"*).

Refusal correctness needs no judge: the system either returned
`refused_unsupported` or it did not, and the dataset says which it should have
been. Both directions are scored — refusing an answerable question is as wrong as
answering an unanswerable one.

Alongside the judge there is a **deterministic citation check**: did the answer
cite a page that is in `gold_pages`? That is a weaker signal than the judge's
verdict (a citation can be on the right page for the wrong claim), but it cannot
itself hallucinate, so it is the number to trust when the two disagree.

### 6. The judge is explicit, versioned, and distrusted

`api/src/rag/judge.ts` grades three independent properties — `faithful`,
`citations_correct`, `answers_the_question` — under a `responseSchema`, at
temperature 0, with the prompt version (`judge-v1`) stored on every result.

Versioning is load-bearing: a judge whose prompt drifts makes two runs
incomparable, which would silently invalidate every before/after in
`eval-history.md`.

The judge is told explicitly that **a claim true in the real world but absent
from the excerpts is not faithful** — that specific confusion is the failure the
faithfulness metric exists to catch, and a judge that "knows" orbital mechanics
will otherwise wave it through.

A judge error is recorded as `null`, not as a failing grade. An unreachable judge
must not move the headline number for an infrastructure reason.

#### Limitations of LLM-as-judge

Stated plainly, because a metric whose limitations are unstated is worse than no
metric:

1. **The judge is the same family of model as the system under test.** It shares
   its blind spots. A hallucination that reads fluently to the answerer reads
   fluently to the judge.
2. **It sees only the retrieved excerpts.** It therefore cannot know whether the
   paper answers the question elsewhere, so it cannot distinguish "correctly
   refused" from "retrieval failed and the refusal was lucky". That is why
   retrieval hit-rate is measured separately and why the two must be read
   together.
3. **It is not calibrated against human labels.** Verdicts are spot-checked by
   hand (the practice, not a guarantee); no inter-rater agreement is claimed.
4. **It is sensitive to its own prompt.** `judge-v1` is one phrasing; a different
   one would give different rates. Only *differences* between runs at the same
   judge version mean anything, and even then only if nothing else moved.
5. **Faithfulness and citation correctness are correlated** — a judge that
   mis-grades one often mis-grades the other — so they are not two independent
   checks, and quoting both as if they were would overstate the evidence.
6. **n is small.** 23 answerable cases, one sample each.

The structural defence against all six: the system does not rely on the judge to
be right about citations. Citations are **verified in code** against the chunks
actually retrieved (ADR-006 §7), and an answer whose citations all fail
verification is downgraded to a refusal. The judge measures quality; the code
enforces the invariant. That is deliberate — it is why `verified_citation_rejections`
is reported alongside the judge's verdict.

### 7. The harness lives outside the service it grades

`evals/` is a top-level directory, not a subpackage of `science/`, even though it
imports `orbital.py` directly and ADR-003 promised "zero glue".

Reason: `science/Dockerfile` does `COPY . .`. Anything inside that package ships
to production — eval datasets, judge prompts, 3 MB of third-party PDFs, test
dependencies. Three lines of `sys.path` is a smaller cost than a production image
that contains the grader for the thing it grades.

**The runners are split by language, following their ground truth.** The physics
runner is Python because its grader must import `orbital.py` with nothing in
between; the RAG runner is TypeScript because retrieval *is* TypeScript and a
subprocess per case would be slower and less faithful. Neither language was
chosen for its own sake.

The physics runner drives the agent as a **subprocess** (`agent-cli.ts --json`)
rather than over HTTP, because the HTTP route sits behind Supabase JWT auth and
minting a token to grade physics would make the harness depend on an identity
provider being up. The subprocess calls exactly the same `runAgent()` the route
calls.

### 8. CI runs a deterministic 15-case smoke subset

Chosen by **round-robin over topics**, not randomly: a smoke run must be
reproducible across CI runs, and a random 15 could miss a whole formula. A test
asserts the subset is deterministic and covers every topic.

The full 60-case suite is on demand (`--full`), because 60 cases × 3 model calls
is three days of free-tier quota and no PR should wait on that.

### 9. Accuracy counts only cases that were actually graded

A case where the agent could not be reached (quota, 503) is reported as
`errored`, separately, and excluded from the accuracy denominator. Folding
infrastructure failures into an accuracy figure would understate the model and
hide the real cause. Both numbers are always printed together, so
"84% (21/25 graded, 3 not reached)" is never silently "84%".

## Alternatives Considered

**Hand-written expected answers.** Faster to author, no generator to maintain.
Rejected flatly: it makes the harness grade the model against my arithmetic, and
the entire ADR-003 argument collapses. This is the one decision in this ADR with
no real tradeoff.

**An LLM judge for physics too.** Uniform machinery, handles prose answers.
Rejected: a right answer exists, so using a probabilistic grader where exact
arithmetic is available would be strictly worse and would import every limitation
in §6 into the one metric that can be free of them.

**Exact string match on the final answer instead of tolerance.** Simpler, no
tolerance to justify. Rejected: it fails a correct answer that rounds differently
or words the unit differently, which makes the metric measure formatting.

**Human evaluation of answer quality.** The gold standard, and genuinely better
than §6's judge. Rejected on cost at this scale: 23 cases per run × several runs
is hours of careful reading per experiment, which would mean the experiment never
runs. The judge is the affordable approximation and is labelled as one.

**RAGAS / DeepEval / an off-the-shelf framework.** Standard metrics, community
prompts, less code. Genuinely tempting. Rejected for the same reason ADR-005
rejected an agent framework: the metric definitions *are* the engineering being
demonstrated here, and inheriting someone else's faithfulness prompt would mean
being unable to explain the number. Also, every one of them would spend
`generateContent` quota on metrics that §3 gets for free.

**Scoring retrieval by chunk id instead of page.** Less ambiguous labelling.
Rejected because the product's promise is a *page citation*, so the metric should
measure what the user sees; chunk ids also change whenever chunk size changes,
which would make the dataset unusable for the very experiment ADR-006 wants.

**Storing eval results in `eval_runs`/`eval_results` (migration 001) only.**
The schema exists and is the intended destination. Results are currently written
to JSON files *as well*, because the Supabase project is unreachable from this
environment and a harness that cannot run without a database is a harness that
does not run. The JSON is the source of truth for `eval-history.md`; the tables
remain the durable store once the database is reachable, and the payload shape
already matches their columns (`git_sha`, `prompt_version`, `model`, `suite`,
`config` / `question_id`, `passed`, `score`, `details`).

## Consequences

One command produces a scored report. Measured on the real system (see
`docs/eval-history.md` for the numbers and their run conditions, and EXP-001 for
the experiment).

**What this design buys:** a physics number that cannot be argued with, a
retrieval number that can be re-measured for free, and an answer-quality number
that is honest about being an approximation. Prompt changes are now *decisions
with evidence* — `agent-v2` and `agent-v3` both came from the adversarial suite
finding specific wrong behaviour, and the fixes were re-run and confirmed rather
than assumed.

**The cost I weight most heavily:** sample size. 60 physics cases and 23 RAG
cases, with the smoke subset at 15, is small enough that a single case flipping
moves the headline percentage by 2–7 points. Every number in `eval-history.md`
therefore carries its denominator, and no run-to-run difference smaller than a
couple of cases should be read as a real change. The free-tier quota is the
direct cause; a paid key would make a 60-case run routine rather than a
three-day budget.

Secondary costs accepted: the judge's limitations (§6, mitigated by the
deterministic citation check and by code-level verification); gold labels
authored by the same person who built the retriever (§4, mitigated by a stated
rule and documented corrections); and results living in JSON rather than Postgres
until the database is reachable.

**Revisit trigger:** if the physics accuracy sits at the ceiling across two full
runs, the dataset is too easy and needs harder multi-step cases rather than more
of the same. If retrieval hit-rate falls below ~80%, ADR-006's revisit trigger
fires (semantic chunking before a bigger `top_k`). If the judge's verdicts and
the deterministic citation check disagree on more than a couple of cases, trust
the deterministic one and re-examine `judge-v1`.

## References

- ADR-003 (deterministic engine as ground truth), ADR-005 (agent guardrails), ADR-006 (chunking and retrieval)
- `docs/eval-history.md` — results over time · `docs/experiments/exp-001.md` — hybrid vs vector-only
- `docs/failure-modes.md` — the adversarial suite that drove `agent-v2` and `agent-v3`
- `evals/build_physics_dataset.py`, `evals/run_physics.py`, `api/scripts/run-rag-eval.ts`, `api/src/rag/judge.ts`
