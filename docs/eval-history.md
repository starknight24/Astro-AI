# Evaluation History

Every number here came from a run of the harness in `evals/`. Nothing is
estimated, projected, or rounded up. Design and limitations:
[ADR-007](decisions/ADR-007-eval-design.md).

**Read the denominators.** The datasets hold 60 physics cases and 28 RAG cases
(23 answerable, 5 unanswerable), but a *run* samples far fewer: the Gemini free
tier allows **20 `generateContent` requests per day per model** (measured) and one
agent run costs three, so the physics smoke subset is **6 cases** — 18 calls. On a
sample that size, one case flipping moves the headline by 17 points. No
run-to-run difference of fewer than ~2 cases is a real change.

Retrieval metrics are the exception: `--retrieval-only` needs embeddings but no
`generateContent` calls, so it runs the **full 23-case** gold set and can be
re-run freely. That is why the retrieval numbers carry weight the answer-quality
numbers do not.

## v0.6 — current scores

```
Physics accuracy    : 100%   (3/3 graded, 2 of 6 not reached — model quota)
Retrieval hit-rate  :  96%   (22/23, hybrid, top_k=6, full gold set)
Refusal accuracy    : 100%   (4/4 unanswerable correctly refused)
Faithfulness        : 100%   (judge-v1, 5 answers)
Citation correctness: 100%   (judge-v1) · 5/5 cited a gold page (deterministic)
Citations rejected by code verification: 0
```

Run conditions, because the numbers mean nothing without them: agent
`gemini-3-flash-preview` with prompts `agent-v3`; answerer `gemini-3.5-flash-lite`
with `rag-v1`; judge `gemini-flash-lite-latest` with `judge-v1`; embeddings
`gemini-embedding-001` at 768 dims; dataset `rag-golden-v2`.

**These are small samples.** 3 graded physics cases and 5 judged answers. 100%
here means "nothing failed in this sample", not "nothing fails". The sample sizes
are set by the free-tier cap of 20 `generateContent` requests per day per model,
measured — see the note below and ADR-007 §9.

```bash
# Physics: question -> full agent -> numeric answer -> graded against science/orbital.py
python3 evals/run_physics.py                 # 6-case stratified smoke subset (quota-sized)
python3 evals/run_physics.py --full          # all 60

# RAG: retrieval hit-rate (no model calls), plus answers + judge when asked
cd api && npx tsx scripts/run-rag-eval.ts --retrieval-only
cd api && npx tsx scripts/run-rag-eval.ts    # + answers + judge
```

---

## Physics accuracy

Agent answer vs. the deterministic engine, 1% relative tolerance (2% for Hohmann
delta-v). `graded` excludes cases where the agent could not be reached at all —
those are counted separately so a quota outage never masquerades as a physics
error.

| Date | Suite | Model | Prompt | Accuracy | Graded | Latency p50 / p95 | Tokens in/out | Commit |
|---|---|---|---|---|---|---|---|---|
| 2026-10-02 | smoke-6 | gemini-3-flash-preview | agent-v3 | **100%** | 3/3 (+2 not reached) | 72s / 84s | 17904/10881 | `4b9b93d5` |
<!-- physics-rows -->

---

## RAG retrieval & answer quality

`retrieval-only` runs need embeddings but **no** `generateContent` calls, which
is why they can be re-run freely. Faithfulness and citation correctness come from
the versioned LLM judge (`judge-v1`) and carry every limitation in ADR-007 §6.

| Date | Mode | Retrieval | Hit-rate | MRR | Refusal | Faithfulness | Citations | Label |
|---|---|---|---|---|---|---|---|---|
| 2026-10-01 | retrieval-only | hybrid, k=6 | **96%** (22/23) | 0.8007 | – | – | – | EXP-001 arm A |
| 2026-10-01 | retrieval-only | vector-only, k=6 | **91%** (21/23) | 0.7645 | – | – | – | EXP-001 arm B |
| 2026-09-30 | retrieval-only | hybrid, k=6 | 87% (20/23) | 0.6558 | – | – | – | pre-correction, `rag-golden-v1` |
| 2026-10-02 | full | hybrid, k=6 | **100%** (5/5) | 1.0000 | **100%** (4/4) | **100%** | **100%** | stratified: 3 papers, 5 answerable + 4 unanswerable |
| 2026-10-02 | full | hybrid, k=6 | **100%** (8/8) | 0.9375 | not measured | 100% | 100% | first-8 sample — **biased**, see note |
<!-- rag-rows -->

> The "first-8 sample" row is kept as a methodology note. `--limit` originally
> took the first N cases, and the dataset is ordered by paper, so that sample was
> nine answerable questions about one paper and **zero** unanswerable ones —
> producing a meaningless "refusal accuracy 100% (0/0)". `--limit` now samples
> round-robin across papers *and* across answerable/unanswerable, and a run with
> no unanswerable cases reports refusal as "not measured" rather than as 100%.
>
> The 2026-09-30 row is kept deliberately. It used `rag-golden-v1`, whose gold
> labels were too narrow — one "miss" was a page the retriever had actually
> returned (ADR-007 §4). The labels were corrected uniformly across all 23 cases
> and the dataset versioned `rag-golden-v2`. **The 87% and the 96% are not
> comparable**; the row stays so the correction is visible rather than erased.

---

## Experiments

| ID | Variable changed | Result | Decision |
|---|---|---|---|
| [EXP-001](experiments/exp-001.md) | `hybrid: true` → `false` | hit-rate 95.7% → 91.3%, MRR 0.801 → 0.765 | keep hybrid retrieval on |

---

## Prompt versions

Bumped whenever a prompt changes, so rows above stay comparable. Each bump below
came from a specific failure found by the adversarial suite, not from a hunch.

| Version | Date | Why |
|---|---|---|
| `agent-v1` | 2026-09-30 | initial |
| `agent-v2` | 2026-09-30 | a −500 km altitude was refused as *out of domain*; separated subject from answerability. Also: unit assumptions were applied silently, and prose carried 15 significant figures. ([failure-modes](failure-modes.md) A1, A2, B1) |
| `agent-v3` | 2026-09-30 | asked for "the Hohmann transfer delta-v" with no orbits given, the agent invented 300 km → 35,786 km, answered, and called those altitudes "provided". Enumerated the four `insufficient_data` cases and forbade describing an assumed value as given. ([failure-modes](failure-modes.md) B2, C2, D1) |
| `rag-v1` | 2026-09-30 | initial |
| `judge-v1` | 2026-10-01 | initial |

---

## Known gaps in these numbers

- **Physics runs use whichever model had daily quota left**, recorded per row.
  Rows with different models are not a model comparison — nothing else was held
  constant.
- **One sample per case.** These are pass/fail observations of a stochastic
  system, not rates. The same case can flip between runs.
- **Faithfulness and citation correctness are judge verdicts**, correlated with
  each other, uncalibrated against human labels, and blind to anything outside
  the retrieved excerpts (ADR-007 §6). The deterministic companions —
  `cited a gold page` and `citations rejected by verification` — are the numbers
  to trust when they disagree.
- **Gold labels were authored by the same person who built the retriever**, in
  one session. Mitigated by a stated labelling rule applied uniformly, with
  corrections in both directions, documented in ADR-007 §4 and EXP-001.
- **Results live in JSON files**, not in the `eval_runs`/`eval_results` tables
  that migration 001 created for them, because the Supabase project is
  unreachable from the development environment. The payload shape already matches
  those columns.
