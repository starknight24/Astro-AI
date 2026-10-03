"""Render an eval result file as a row for docs/eval-history.md.

    python3 evals/append_history.py evals/results/physics-*.json [--write]

Without --write it prints the row, so CI can put it in a job summary without
committing anything. With --write it appends under the right table in
docs/eval-history.md.

Every row carries its denominator and its run conditions (model, prompt version,
git sha). ADR-007 §9: a percentage without its sample size invites reading a
one-case flip as a trend.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HISTORY = Path(__file__).resolve().parent.parent / "docs" / "eval-history.md"

PHYSICS_MARKER = "<!-- physics-rows -->"
RAG_MARKER = "<!-- rag-rows -->"


def pct(value: float | None) -> str:
    return "–" if value is None else f"{value * 100:.0f}%"


def physics_row(payload: dict) -> str:
    run, summary = payload["run"], payload["summary"]
    accuracy = pct(summary["accuracy"])
    graded = f"{summary['passed']}/{summary['graded']}"
    not_reached = f" (+{summary['errored']} not reached)" if summary["errored"] else ""
    latency = summary["latency_ms"]
    p50 = f"{latency['p50'] / 1000:.0f}s" if latency["p50"] else "–"
    p95 = f"{latency['p95'] / 1000:.0f}s" if latency["p95"] else "–"
    return (
        f"| {run['started_at'][:10]} | {run['suite']} | {run.get('model') or 'default'} "
        f"| {run.get('prompt_version') or '?'} | **{accuracy}** | {graded}{not_reached} "
        f"| {p50} / {p95} | {summary['tokens_in']}/{summary['tokens_out']} "
        f"| `{run['git_sha'][:8]}` |"
    )


def rag_row(payload: dict) -> str:
    run, summary = payload["run"], payload["summary"]
    retrieval = run["retrieval"]
    mode = f"{'hybrid' if retrieval['hybrid'] else 'vector-only'}, k={retrieval['top_k']}"
    hit = pct(summary["retrieval_hit_rate"])
    faith = pct(summary["faithfulness"])
    cites = pct(summary["citation_correctness"])
    refusal = pct(summary["refusal_accuracy"])
    return (
        f"| {run['started_at'][:10]} | {run['mode']} | {mode} "
        f"| **{hit}** ({summary['retrieval_hits']}/{summary['answerable']}) "
        f"| {summary['mrr'] if summary['mrr'] is not None else '–'} "
        f"| {refusal} ({summary['correct_refusals']}/{summary['unanswerable']}) "
        f"| {faith} | {cites} | {run.get('label') or ''} |"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", help="a physics-*.json or rag-*.json result file")
    parser.add_argument("--write", action="store_true", help="append to docs/eval-history.md")
    args = parser.parse_args()

    payload = json.loads(Path(args.result).read_text(encoding="utf-8"))
    is_physics = "by_topic" in payload["summary"]
    row = physics_row(payload) if is_physics else rag_row(payload)
    marker = PHYSICS_MARKER if is_physics else RAG_MARKER

    print(row)
    if not args.write:
        return 0

    text = HISTORY.read_text(encoding="utf-8")
    if marker not in text:
        print(f"marker {marker} not found in {HISTORY}", file=sys.stderr)
        return 1
    HISTORY.write_text(text.replace(marker, f"{row}\n{marker}"), encoding="utf-8")
    print(f"appended to {HISTORY}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
