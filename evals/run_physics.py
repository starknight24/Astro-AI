"""Physics eval runner: question -> full agent -> numeric answer -> graded against the engine.

    python3 evals/run_physics.py                     # smoke subset (quota-sized)
    python3 evals/run_physics.py --full              # all 60 cases
    python3 evals/run_physics.py --limit 10 --model gemini-3.6-flash
    python3 evals/run_physics.py --report            # re-print the last run

Grading is exact arithmetic against `science/orbital.py`, imported directly —
the agent's number is compared to the engine's, with no model in the loop
(ADR-003, ADR-007).

The agent runs as a subprocess (`api/scripts/agent-cli.ts --json`) rather than
over HTTP: the HTTP route sits behind Supabase JWT auth, and minting a token to
grade physics would make the harness depend on an identity provider being up.
The subprocess runs exactly the same `runAgent()` the route calls.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import _path  # noqa: F401

REPO_ROOT = Path(__file__).resolve().parent.parent
DATASET = Path(__file__).parent / "datasets" / "physics_golden.json"
RESULTS_DIR = Path(__file__).parent / "results"
AGENT_CLI = REPO_ROOT / "api" / "scripts" / "agent-cli.ts"

# Smoke subset size, derived from the quota rather than chosen.
#
# The free tier allows 20 generateContent requests per day per model (measured),
# and one case costs three model calls: plan, tool round, synthesis. 6 cases is
# 18 calls, which fits; the 15 the plan originally specified needs 45 and cannot
# complete on one model. Raise this with --limit when a paid key is available.
SMOKE_SIZE = 6

#: What the plan asks for once quota allows it; kept so the intent is recorded.
PLANNED_SMOKE_SIZE = 15

# Pause between cases. The free tier limits requests per minute as well as per
# day, and one agent run is three model calls.
PAUSE_S = 12.0

RATE_LIMITED = re.compile(r"RESOURCE_EXHAUSTED|429|rate.?limit|quota", re.I)
DAILY_LIMIT = re.compile(r"PerDay|RequestsPerDay", re.I)


@dataclass
class Graded:
    id: str
    question: str
    topic: str
    difficulty: str
    expected_value: float
    expected_unit: str
    tolerance: float
    status: str | None = None
    actual_value: float | None = None
    actual_unit: str | None = None
    #: Kept so a failure can be diagnosed from the result file. Re-running a case
    #: costs model quota, so the first run has to record enough to explain itself.
    final_answer: str | None = None
    reported_quantities: list[dict] = field(default_factory=list)
    relative_error: float | None = None
    passed: bool = False
    failure_reason: str | None = None
    tool_calls: int | None = None
    duration_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    guardrails: list[str] = field(default_factory=list)
    #: Guardrail detail text, so a quota message inside it is visible to the
    #: early-stop check. Without this the runner burned every remaining case
    #: against an exhausted model.
    guardrail_detail: str = ""
    model: str | None = None
    prompt_version: str | None = None
    ungrounded_values: list[float] = field(default_factory=list)
    error: str | None = None


def stratified_subset(cases: list[dict], size: int) -> list[dict]:
    """Take `size` cases spread evenly across topics, deterministically.

    Round-robin over topics rather than a random sample: a smoke run must be
    reproducible across CI runs, and a random 15 could miss a whole topic.
    """
    by_topic: dict[str, list[dict]] = {}
    for case in cases:
        by_topic.setdefault(case["topic"], []).append(case)
    for bucket in by_topic.values():
        bucket.sort(key=lambda c: c["id"])

    chosen: list[dict] = []
    topics = sorted(by_topic)
    index = 0
    while len(chosen) < size and any(by_topic.values()):
        topic = topics[index % len(topics)]
        if by_topic[topic]:
            chosen.append(by_topic[topic].pop(0))
        index += 1
        if index > size * len(topics) * 2:
            break
    return sorted(chosen, key=lambda c: c["id"])[:size]


def extract_value(result: dict[str, Any], expected_unit: str) -> tuple[float | None, str | None]:
    """Pull the agent's numeric answer out of the output contract.

    Preference order, strongest evidence first:
      1. a `quantities` entry whose unit matches the question's unit
      2. any `quantities` entry (unit mismatch is reported separately)
      3. the first number in `final_answer`

    The contract exists precisely so this does not have to be regex-first; the
    prose fallback is for a model that filled `final_answer` but left
    `quantities` empty.
    """
    answer = result.get("answer") or {}
    quantities = answer.get("quantities") or []

    def norm(unit: str) -> str:
        return re.sub(r"[\s^*]", "", unit.lower()).replace("**", "")

    target = norm(expected_unit)
    matching: list[tuple[float, str]] = []
    for quantity in quantities:
        if norm(str(quantity.get("unit", ""))) == target:
            try:
                matching.append((float(quantity["value"]), str(quantity.get("unit"))))
            except (TypeError, ValueError, KeyError):
                continue

    if matching:
        # Several quantities can share a unit — a Hohmann answer reports delta_v1,
        # delta_v2 and the total, all in km/s. Taking the first would grade the
        # wrong one (observed: 2.45 km/s graded against a 3.93 km/s total). Prefer
        # the value the model actually PUT IN THE PROSE, because that is the one
        # the student reads.
        prose = str(answer.get("final_answer") or "")
        if len(matching) > 1:
            for value, unit in matching:
                if _appears_in(prose, value):
                    return value, unit
        return matching[0]
    for quantity in quantities:
        try:
            return float(quantity["value"]), str(quantity.get("unit"))
        except (TypeError, ValueError, KeyError):
            continue

    text = str(answer.get("final_answer") or "")
    match = re.search(r"[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?|[-+]?\d*\.?\d+", text)
    if match:
        try:
            return float(match.group(0).replace(",", "")), None
        except ValueError:
            return None, None
    return None, None


def _appears_in(text: str, value: float) -> bool:
    """True when `value` is written in `text`, at any sensible rounding.

    The prose rounds ("3.93 km/s"), so an exact string search fails. Comparing at
    2-6 significant figures matches what a reader would recognise as the same
    number.
    """
    numbers = re.findall(r"[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-+]?\d*\.?\d+", text)
    for raw in numbers:
        try:
            found = float(raw.replace(",", ""))
        except ValueError:
            continue
        denominator = abs(value) if value != 0 else 1.0
        if abs(found - value) / denominator <= 0.005:
            return True
    return False


def grade(case: dict[str, Any], result: dict[str, Any] | None, error: str | None) -> Graded:
    row = Graded(
        id=case["id"],
        question=case["question"],
        topic=case["topic"],
        difficulty=case["difficulty"],
        expected_value=case["expected_value"],
        expected_unit=case["expected_unit"],
        tolerance=case["tolerance"],
    )
    if result is None:
        row.error = error
        row.failure_reason = "agent_error"
        return row

    meta = result.get("meta") or {}
    row.status = result.get("status")
    row.tool_calls = meta.get("tool_calls")
    row.duration_ms = meta.get("duration_ms")
    row.tokens_in = meta.get("tokens_in")
    row.tokens_out = meta.get("tokens_out")
    row.guardrails = meta.get("guardrails_triggered") or []
    row.model = meta.get("model")
    row.prompt_version = meta.get("prompt_version")
    details: list[str] = []
    for entry in result.get("trace") or []:
        if entry.get("type") == "synthesis":
            row.ungrounded_values = entry.get("ungrounded_values") or []
        if entry.get("type") == "guardrail":
            details.append(str(entry.get("detail") or ""))
    row.guardrail_detail = " ".join(details)[:2000]

    answer = result.get("answer") or {}
    row.final_answer = str(answer.get("final_answer") or "")[:600]
    row.reported_quantities = list(answer.get("quantities") or [])[:12]

    # `status == "error"` means the agent never produced an answer: the planner
    # was unreachable, a tool round died, or synthesis failed. Every one of those
    # is infrastructure, and none of them is a wrong physics answer — so the case
    # was NOT GRADED and is excluded from the accuracy denominator (ADR-007 §9).
    #
    # Narrowing this to 429s was not enough: a run against a flaky model returned
    # 503 "high demand" and three cases were scored as physics failures, dropping
    # a 100% run to 0%. A wrong answer shows up as `answered` with a bad number,
    # or as `insufficient_data` — both of which stay graded.
    if row.status == "error":
        row.error = (
            "model quota or rate limit exhausted"
            if RATE_LIMITED.search(row.guardrail_detail)
            else f"agent produced no answer: {row.guardrail_detail[:160] or 'unknown cause'}"
        )
        row.failure_reason = "agent_error"
        return row

    if row.status != "answered":
        row.failure_reason = f"status_{row.status}"
        return row

    value, unit = extract_value(result, case["expected_unit"])
    row.actual_value = value
    row.actual_unit = unit
    if value is None:
        row.failure_reason = "no_numeric_answer"
        return row

    expected = case["expected_value"]
    denominator = abs(expected) if expected != 0 else 1.0
    row.relative_error = abs(value - expected) / denominator
    if row.relative_error <= case["tolerance"]:
        row.passed = True
    else:
        row.failure_reason = "outside_tolerance"
    return row


def run_case(case: dict[str, Any], model: str | None, timeout_s: float) -> tuple[dict | None, str | None]:
    env_prefix = []
    command = ["npx", "tsx", str(AGENT_CLI), "--json", case["question"]]
    try:
        completed = subprocess.run(
            env_prefix + command,
            cwd=REPO_ROOT / "api",
            capture_output=True,
            text=True,
            timeout=timeout_s,
            env=_child_env(model),
        )
    except subprocess.TimeoutExpired:
        return None, f"agent timed out after {timeout_s:.0f}s"

    start = completed.stdout.find("{")
    if start < 0:
        return None, (completed.stderr or completed.stdout)[-600:]
    try:
        return json.loads(completed.stdout[start:]), completed.stderr[-600:] or None
    except json.JSONDecodeError as exc:
        return None, f"unparseable agent output: {exc}"


def _child_env(model: str | None) -> dict[str, str]:
    import os

    env = dict(os.environ)
    if model:
        env["AGENT_MODEL"] = model
    return env


def summarise(rows: list[Graded]) -> dict[str, Any]:
    graded = [r for r in rows if r.error is None]
    passed = [r for r in graded if r.passed]
    by_topic: dict[str, dict[str, int]] = {}
    for row in graded:
        bucket = by_topic.setdefault(row.topic, {"n": 0, "passed": 0})
        bucket["n"] += 1
        bucket["passed"] += 1 if row.passed else 0
    by_difficulty: dict[str, dict[str, int]] = {}
    for row in graded:
        bucket = by_difficulty.setdefault(row.difficulty, {"n": 0, "passed": 0})
        bucket["n"] += 1
        bucket["passed"] += 1 if row.passed else 0

    failures: dict[str, int] = {}
    for row in graded:
        if not row.passed and row.failure_reason:
            failures[row.failure_reason] = failures.get(row.failure_reason, 0) + 1

    latencies = sorted(r.duration_ms for r in graded if r.duration_ms is not None)
    tokens_in = sum(r.tokens_in or 0 for r in graded)
    tokens_out = sum(r.tokens_out or 0 for r in graded)

    return {
        "graded": len(graded),
        "errored": len(rows) - len(graded),
        "passed": len(passed),
        # Accuracy over GRADED cases only. An agent that could not be reached is
        # a harness/quota problem, not a physics error, and folding it into the
        # headline number would understate accuracy and hide the real cause.
        "accuracy": round(len(passed) / len(graded), 4) if graded else None,
        "by_topic": {k: {**v, "accuracy": round(v["passed"] / v["n"], 4)} for k, v in sorted(by_topic.items())},
        "by_difficulty": {
            k: {**v, "accuracy": round(v["passed"] / v["n"], 4)} for k, v in sorted(by_difficulty.items())
        },
        "failure_reasons": dict(sorted(failures.items())),
        "latency_ms": {
            "p50": latencies[len(latencies) // 2] if latencies else None,
            "p95": latencies[min(int(len(latencies) * 0.95), len(latencies) - 1)] if latencies else None,
            "max": latencies[-1] if latencies else None,
        },
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


def print_report(payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    print("=" * 74)
    print(f"PHYSICS EVAL  {payload['run']['started_at']}")
    print(
        f"model={payload['run']['model'] or '(default)'}  prompt={payload['run'].get('prompt_version') or '?'}  "
        f"suite={payload['run']['suite']}  git={payload['run']['git_sha'][:8]}"
    )
    print("=" * 74)
    accuracy = summary["accuracy"]
    print(
        f"Physics accuracy: {accuracy * 100:.0f}%  ({summary['passed']}/{summary['graded']} graded"
        + (f", {summary['errored']} not reached" if summary["errored"] else "")
        + ")"
    )
    if summary["latency_ms"]["p50"] is not None:
        print(
            f"Agent latency   : p50 {summary['latency_ms']['p50'] / 1000:.1f}s  "
            f"p95 {summary['latency_ms']['p95'] / 1000:.1f}s  max {summary['latency_ms']['max'] / 1000:.1f}s"
        )
    print(f"Tokens          : {summary['tokens_in']} in / {summary['tokens_out']} out")
    print("\nBy topic:")
    for topic, stats in summary["by_topic"].items():
        print(f"  {topic:<26} {stats['passed']:>2}/{stats['n']:<2} {stats['accuracy'] * 100:>5.0f}%")
    print("\nBy difficulty:")
    for level, stats in summary["by_difficulty"].items():
        print(f"  {level:<26} {stats['passed']:>2}/{stats['n']:<2} {stats['accuracy'] * 100:>5.0f}%")
    if summary["failure_reasons"]:
        print("\nFailure reasons:", summary["failure_reasons"])

    failed = [r for r in payload["results"] if not r["passed"]]
    if failed:
        print(f"\nFailures ({len(failed)}):")
        for row in failed[:20]:
            if row.get("error"):
                print(f"  {row['id']}  ERROR  {str(row['error'])[:90]}")
                continue
            print(
                f"  {row['id']}  expected {row['expected_value']} {row['expected_unit']}"
                f"  got {row['actual_value']} {row['actual_unit'] or '?'}"
                + (f"  relerr={row['relative_error']:.4f}" if row.get("relative_error") is not None else "")
                + f"  [{row['failure_reason']}]"
            )
            if row.get("final_answer"):
                print(f"        said: {row['final_answer'][:150]}")
            if row.get("reported_quantities"):
                shown = ", ".join(
                    f"{q.get('quantity')}={q.get('value')} {q.get('unit')}"
                    for q in row["reported_quantities"][:4]
                )
                print(f"        reported: {shown}")


def git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        return "unknown"


def observed_model(rows: list) -> str | None:
    """The model(s) the agent reported, joined if a run spanned several."""
    seen = sorted({r.model for r in rows if getattr(r, "model", None)})
    if not seen:
        return None
    return seen[0] if len(seen) == 1 else ", ".join(seen)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="run all cases")
    parser.add_argument("--limit", type=int, default=None, help="run this many cases")
    parser.add_argument("--model", default=None, help="override AGENT_MODEL")
    parser.add_argument("--timeout", type=float, default=240.0, help="per-case timeout, seconds")
    parser.add_argument("--pause", type=float, default=PAUSE_S, help="seconds between cases")
    parser.add_argument("--out", default=None, help="result file (default: results/physics-<ts>.json)")
    parser.add_argument("--report", default=None, help="re-print a saved result file and exit")
    args = parser.parse_args()

    if args.report:
        print_report(json.loads(Path(args.report).read_text(encoding="utf-8")))
        return 0

    cases = json.loads(DATASET.read_text(encoding="utf-8"))
    if args.full:
        selected, suite = cases, "full"
    else:
        size = args.limit or SMOKE_SIZE
        selected, suite = stratified_subset(cases, size), f"smoke-{size}"
    if args.limit and args.full:
        selected, suite = cases[: args.limit], f"full-{args.limit}"

    started = datetime.now(timezone.utc)
    print(f"running {len(selected)} physics case(s) [{suite}] against the full agent\n", flush=True)

    rows: list[Graded] = []
    stopped_early: str | None = None
    for index, case in enumerate(selected, start=1):
        result, stderr = run_case(case, args.model, args.timeout)
        row = grade(case, result, stderr if result is None else None)
        rows.append(row)
        mark = "PASS" if row.passed else "FAIL"
        detail = (
            f"{row.actual_value} vs {row.expected_value} {row.expected_unit}"
            if row.actual_value is not None
            else (row.failure_reason or "?")
        )
        print(f"  [{index}/{len(selected)}] {row.id} {mark:<4} {row.topic:<24} {detail}", flush=True)

        text = f"{row.error or ''} {row.guardrail_detail} {' '.join(row.guardrails)}"
        if RATE_LIMITED.search(text) and DAILY_LIMIT.search(text):
            stopped_early = f"stopped at {row.id}: this model's per-day request cap was reached"
            print(f"\n{stopped_early}", flush=True)
            break
        if index < len(selected) and args.pause > 0:
            time.sleep(args.pause)

    payload = {
        "run": {
            "suite": suite,
            "started_at": started.isoformat(timespec="seconds"),
            "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "git_sha": git_sha(),
            # The model the agent REPORTS having used, not the one we asked
            # for. `args.model` is None unless --model was passed, which left
            # committed results saying "(default)" -- unreproducible, and
            # actively misleading now that Google aliases one model string onto
            # another and bills a different quota. Each case records what it
            # actually ran on; promote that, and keep every distinct value if a
            # run somehow spanned more than one.
            "model": observed_model(rows) or args.model,
            "prompt_version": next((r.prompt_version for r in rows if r.prompt_version), None),
            "dataset": DATASET.name,
            "dataset_size": len(cases),
            "stopped_early": stopped_early,
        },
        "summary": summarise(rows),
        "results": [vars(r) for r in rows],
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out) if args.out else RESULTS_DIR / f"physics-{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")

    print()
    print_report(payload)
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
