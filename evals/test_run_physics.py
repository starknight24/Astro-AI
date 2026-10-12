"""Tests for the physics eval harness.

The grading logic is the part that must not be wrong: a bug here silently
reports the model as better or worse than it is, and every number in
docs/eval-history.md depends on it. All of it is pure functions over recorded
agent output, so none of these tests touch a model or the network.
"""
import json
from pathlib import Path

import pytest

import run_physics
from run_physics import extract_value, grade, stratified_subset, summarise

DATASET = Path(__file__).parent / "datasets" / "physics_golden.json"


@pytest.fixture(scope="module")
def dataset() -> list[dict]:
    return json.loads(DATASET.read_text(encoding="utf-8"))


def case(**overrides) -> dict:
    base = {
        "id": "phys-001",
        "question": "What is the orbital period, in minutes, at 400 km?",
        "expected_value": 92.560405,
        "expected_unit": "min",
        "tolerance": 0.01,
        "topic": "orbital_period",
        "difficulty": "easy",
    }
    base.update(overrides)
    return base


def agent_result(quantities, status="answered", final_answer="", trace=None) -> dict:
    return {
        "status": status,
        "answer": {
            "status": status,
            "quantities": quantities,
            "final_answer": final_answer,
            "steps": [],
            "formulas": [],
            "citations": [],
        },
        "trace": trace or [],
        "meta": {
            "tool_calls": 1,
            "duration_ms": 12_000,
            "tokens_in": 500,
            "tokens_out": 200,
            "guardrails_triggered": [],
            "model": "gemini-3.5-flash",
            "prompt_version": "agent-v2",
        },
    }


# ---------- dataset integrity ----------

class TestDataset:
    def test_has_sixty_cases(self, dataset):
        assert len(dataset) == 60

    def test_ids_are_unique(self, dataset):
        ids = [c["id"] for c in dataset]
        assert len(set(ids)) == len(ids)

    def test_every_case_is_complete(self, dataset):
        for c in dataset:
            for key in ("id", "question", "expected_value", "expected_unit", "tolerance", "topic", "difficulty", "derivation"):
                assert key in c, f"{c.get('id')} missing {key}"

    def test_every_question_states_its_unit(self, dataset):
        """Ambiguous units are their own failure mode; this set measures physics."""
        for c in dataset:
            assert c["expected_unit"], c["id"]
            unit_words = {
                "min": ["minute"], "h": ["hour"], "km/s": ["km/s"], "km/h": ["km/h"],
                "km": ["km"], "km^2/s^2": ["km^2/s^2"], "orbits": ["orbit"],
            }[c["expected_unit"]]
            assert any(word in c["question"].lower() for word in unit_words), c["id"]

    def test_tolerances_are_tight_enough_to_catch_a_wrong_formula(self, dataset):
        assert all(0 < c["tolerance"] <= 0.02 for c in dataset)

    def test_expected_values_are_finite_numbers(self, dataset):
        for c in dataset:
            assert isinstance(c["expected_value"], (int, float))
            assert c["expected_value"] == c["expected_value"]  # not NaN

    def test_covers_every_engine_formula(self, dataset):
        topics = {c["topic"] for c in dataset}
        assert topics >= {
            "orbital_period", "orbital_velocity", "escape_velocity",
            "vis_viva", "specific_orbital_energy", "hohmann_transfer",
        }

    def test_spans_all_difficulties(self, dataset):
        assert {c["difficulty"] for c in dataset} == {"easy", "medium", "hard"}

    @pytest.mark.parametrize(
        "needle,reference,label",
        [
            ("at an altitude of 400 km above Earth's surface?", 92.56, "ISS period, min"),
            ("altitude of 35,786 km above Earth's surface?", 23.934, "GEO period, h"),
            ("from an altitude of 0 km above", 11.19, "surface escape velocity, km/s"),
        ],
    )
    def test_matches_independent_reference_values(self, dataset, needle, reference, label):
        """The engine produced these; textbook values confirm the engine."""
        matches = [c for c in dataset if needle in c["question"]]
        assert matches, label
        assert matches[0]["expected_value"] == pytest.approx(reference, rel=0.002), label


# ---------- answer extraction ----------

class TestExtractValue:
    def test_prefers_a_quantity_whose_unit_matches_the_question(self):
        result = agent_result([
            {"quantity": "period", "value": 5553.62, "unit": "s"},
            {"quantity": "period", "value": 92.5604, "unit": "min"},
        ])
        assert extract_value(result, "min") == (92.5604, "min")

    def test_falls_back_to_any_quantity_when_no_unit_matches(self):
        result = agent_result([{"quantity": "period", "value": 5553.62, "unit": "s"}])
        value, unit = extract_value(result, "min")
        assert value == 5553.62 and unit == "s"

    @pytest.mark.parametrize("unit", ["km^2/s^2", "km^2 / s^2", "KM^2/S^2", "km**2/s**2"])
    def test_unit_matching_ignores_spacing_case_and_exponent_style(self, unit):
        result = agent_result([{"quantity": "energy", "value": -29.4, "unit": unit}])
        assert extract_value(result, "km^2/s^2")[0] == -29.4

    def test_falls_back_to_the_first_number_in_the_prose(self):
        result = agent_result([], final_answer="The period is about 92.56 minutes.")
        assert extract_value(result, "min")[0] == pytest.approx(92.56)

    def test_parses_a_thousands_separator_in_prose(self):
        result = agent_result([], final_answer="The semi-major axis is 6,778.137 km.")
        assert extract_value(result, "km")[0] == pytest.approx(6778.137)

    def test_parses_a_negative_value(self):
        result = agent_result([{"quantity": "energy", "value": -29.405, "unit": "km^2/s^2"}])
        assert extract_value(result, "km^2/s^2")[0] == -29.405

    def test_returns_none_when_there_is_no_number_anywhere(self):
        result = agent_result([], final_answer="I could not determine this.")
        assert extract_value(result, "min") == (None, None)

    def test_skips_a_malformed_quantity_entry(self):
        result = agent_result([
            {"quantity": "bad", "value": "not a number", "unit": "min"},
            {"quantity": "good", "value": 92.56, "unit": "min"},
        ])
        assert extract_value(result, "min")[0] == 92.56


# ---------- grading ----------

class TestGrade:
    def test_passes_an_exact_answer(self):
        row = grade(case(), agent_result([{"quantity": "p", "value": 92.560405, "unit": "min"}]), None)
        assert row.passed
        assert row.relative_error == pytest.approx(0.0)

    def test_passes_a_sensibly_rounded_answer(self):
        """The agent rounds in prose; the tolerance exists for exactly this."""
        row = grade(case(), agent_result([{"quantity": "p", "value": 92.56, "unit": "min"}]), None)
        assert row.passed

    def test_fails_an_answer_just_outside_tolerance(self):
        row = grade(case(), agent_result([{"quantity": "p", "value": 94.0, "unit": "min"}]), None)
        assert not row.passed
        assert row.failure_reason == "outside_tolerance"
        assert row.relative_error == pytest.approx(abs(94.0 - 92.560405) / 92.560405)

    def test_fails_an_answer_that_forgot_earth_radius(self):
        """The classic error: using altitude as the semi-major axis."""
        row = grade(case(), agent_result([{"quantity": "p", "value": 4.19, "unit": "min"}]), None)
        assert not row.passed

    def test_fails_a_unit_confusion_even_though_the_digits_look_right(self):
        """5553 s is the right answer in the wrong unit; the question said minutes."""
        row = grade(case(), agent_result([{"quantity": "p", "value": 5553.62, "unit": "s"}]), None)
        assert not row.passed
        assert row.actual_unit == "s"

    def test_records_a_non_answered_status_as_the_failure_reason(self):
        row = grade(case(), agent_result([], status="insufficient_data"), None)
        assert not row.passed
        assert row.failure_reason == "status_insufficient_data"

    def test_records_a_refusal_distinctly(self):
        row = grade(case(), agent_result([], status="refused"), None)
        assert row.failure_reason == "status_refused"

    def test_records_an_agent_error_separately_from_a_wrong_answer(self):
        row = grade(case(), None, "503 UNAVAILABLE")
        assert not row.passed
        assert row.failure_reason == "agent_error"
        assert row.error == "503 UNAVAILABLE"

    def test_flags_an_answer_with_no_number(self):
        row = grade(case(), agent_result([], final_answer="It depends."), None)
        assert row.failure_reason == "no_numeric_answer"

    def test_handles_an_expected_value_of_zero_without_dividing_by_zero(self):
        row = grade(case(expected_value=0.0), agent_result([{"quantity": "x", "value": 0.0, "unit": "min"}]), None)
        assert row.passed

    def test_carries_the_trace_metadata_through(self):
        result = agent_result(
            [{"quantity": "p", "value": 92.56, "unit": "min"}],
            trace=[{"type": "synthesis", "ungrounded_values": [1234.5]}],
        )
        row = grade(case(), result, None)
        assert row.tool_calls == 1
        assert row.model == "gemini-3.5-flash"
        assert row.prompt_version == "agent-v2"
        assert row.ungrounded_values == [1234.5]

    def test_honours_a_per_case_tolerance(self):
        loose = grade(case(tolerance=0.05), agent_result([{"quantity": "p", "value": 95.0, "unit": "min"}]), None)
        tight = grade(case(tolerance=0.001), agent_result([{"quantity": "p", "value": 95.0, "unit": "min"}]), None)
        assert loose.passed and not tight.passed


# ---------- subset selection ----------

class TestStratifiedSubset:
    def test_returns_the_requested_size(self, dataset):
        assert len(stratified_subset(dataset, 15)) == 15

    def test_is_deterministic(self, dataset):
        first = [c["id"] for c in stratified_subset(dataset, 15)]
        second = [c["id"] for c in stratified_subset(dataset, 15)]
        assert first == second, "a smoke subset must be reproducible across CI runs"

    def test_covers_every_topic_at_fifteen(self, dataset):
        chosen = stratified_subset(dataset, 15)
        assert {c["topic"] for c in chosen} == {c["topic"] for c in dataset}

    def test_never_repeats_a_case(self, dataset):
        ids = [c["id"] for c in stratified_subset(dataset, 20)]
        assert len(set(ids)) == len(ids)

    def test_cannot_exceed_the_dataset(self, dataset):
        assert len(stratified_subset(dataset, 500)) == len(dataset)


# ---------- summary ----------

class TestSummarise:
    def _rows(self):
        return [
            grade(case(id="a", topic="orbital_period", difficulty="easy"),
                  agent_result([{"quantity": "p", "value": 92.56, "unit": "min"}]), None),
            grade(case(id="b", topic="orbital_period", difficulty="hard"),
                  agent_result([{"quantity": "p", "value": 50.0, "unit": "min"}]), None),
            grade(case(id="c", topic="hohmann_transfer", difficulty="easy"), None, "503"),
        ]

    def test_accuracy_counts_only_graded_cases(self):
        """An unreachable agent is a harness problem, not a physics error."""
        summary = summarise(self._rows())
        assert summary["graded"] == 2
        assert summary["errored"] == 1
        assert summary["passed"] == 1
        assert summary["accuracy"] == 0.5

    def test_breaks_down_by_topic_and_difficulty(self):
        summary = summarise(self._rows())
        assert summary["by_topic"]["orbital_period"] == {"n": 2, "passed": 1, "accuracy": 0.5}
        assert summary["by_difficulty"]["easy"]["accuracy"] == 1.0

    def test_counts_failure_reasons(self):
        assert summarise(self._rows())["failure_reasons"] == {"outside_tolerance": 1}

    def test_reports_latency_percentiles(self):
        summary = summarise(self._rows())
        assert summary["latency_ms"]["p50"] == 12_000

    def test_sums_tokens(self):
        summary = summarise(self._rows())
        assert summary["tokens_in"] == 1000
        assert summary["tokens_out"] == 400

    def test_accuracy_is_none_when_nothing_could_be_graded(self):
        summary = summarise([grade(case(), None, "503")])
        assert summary["accuracy"] is None
        assert summary["graded"] == 0


def test_smoke_size_fits_one_model_day_of_free_tier_quota():
    """6 cases x 3 model calls = 18, under the measured 20/day/model cap."""
    assert run_physics.SMOKE_SIZE * 3 <= 20
    assert run_physics.SMOKE_SIZE == 6
    assert run_physics.PLANNED_SMOKE_SIZE == 15


class TestMultipleQuantitiesSharingAUnit:
    """A Hohmann answer reports delta_v1, delta_v2 and the total, all in km/s.

    Measured failure: the grader took the first km/s entry and graded 2.45 km/s
    against a 3.93 km/s total, reporting the agent wrong when it had answered
    correctly in the prose.
    """

    def _result(self, prose: str) -> dict:
        return agent_result(
            [
                {"quantity": "delta_v1", "value": 2.4545873, "unit": "km/s"},
                {"quantity": "delta_v2", "value": 1.4772716, "unit": "km/s"},
                {"quantity": "total delta-v", "value": 3.9318589, "unit": "km/s"},
            ],
            final_answer=prose,
        )

    def test_prefers_the_value_written_in_the_prose(self):
        value, _ = extract_value(self._result("The total delta-v is about 3.93 km/s."), "km/s")
        assert value == pytest.approx(3.9318589)

    def test_picks_the_other_value_when_the_prose_says_that_one(self):
        value, _ = extract_value(self._result("The first burn needs 2.45 km/s."), "km/s")
        assert value == pytest.approx(2.4545873)

    def test_falls_back_to_the_first_match_when_the_prose_names_no_number(self):
        value, _ = extract_value(self._result("It depends on the transfer."), "km/s")
        assert value == pytest.approx(2.4545873)

    def test_grades_the_prose_value_as_a_pass(self):
        row = grade(
            case(expected_value=3.931859, expected_unit="km/s", tolerance=0.02),
            self._result("The total delta-v is approximately 3.93 km/s."),
            None,
        )
        assert row.passed

    def test_a_single_matching_quantity_is_used_regardless_of_the_prose(self):
        result = agent_result(
            [{"quantity": "period", "value": 92.56, "unit": "min"}],
            final_answer="Roughly an hour and a half.",
        )
        assert extract_value(result, "min")[0] == pytest.approx(92.56)


class TestFailureDiagnostics:
    def test_records_the_answer_text_and_quantities_for_a_failure(self):
        """Re-running a case costs model quota, so the result file must explain itself."""
        result = agent_result(
            [{"quantity": "period", "value": 50.0, "unit": "min"}],
            final_answer="The period is 50 minutes.",
        )
        row = grade(case(), result, None)
        assert not row.passed
        assert row.final_answer == "The period is 50 minutes."
        assert row.reported_quantities[0]["value"] == 50.0

    def test_records_them_for_a_non_answered_status_too(self):
        result = agent_result([], status="insufficient_data", final_answer="Need the altitude.")
        row = grade(case(), result, None)
        assert row.final_answer == "Need the altitude."

    def test_captures_guardrail_detail_so_a_quota_stop_is_detectable(self):
        result = agent_result([{"quantity": "p", "value": 92.56, "unit": "min"}])
        result["trace"] = [
            {"type": "guardrail", "name": "plan_failed", "detail": 'quotaId: ...PerDay... limit: 20'},
        ]
        row = grade(case(), result, None)
        assert "PerDay" in row.guardrail_detail


class TestCompleteOrbitsWordingFix:
    def test_the_orbits_question_asks_for_a_fractional_answer(self, dataset):
        """The original wording ("complete orbits") made 15 correct and 15.557 wrong."""
        orbits = [c for c in dataset if c["expected_unit"] == "orbits"]
        assert orbits, "expected an orbits-per-day case"
        question = orbits[0]["question"].lower()
        assert "fractional" in question
        assert "complete orbits" not in question


class TestQuotaIsNotAPhysicsFailure:
    """ADR-007 section 9: accuracy counts only cases that were actually graded.

    Measured: a run stopped on the per-day cap recorded the stopping case as
    `status_error`, which pulled the headline accuracy from 100% to 75% for a
    reason unrelated to the model's physics.
    """

    def _quota_result(self) -> dict:
        result = agent_result([], status="error", final_answer="could not be composed")
        result["trace"] = [
            {
                "type": "guardrail",
                "name": "plan_failed",
                "detail": '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED",'
                '"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}',
            }
        ]
        return result

    def test_a_quota_error_is_recorded_as_not_reached(self):
        row = grade(case(), self._quota_result(), None)
        assert row.error is not None
        assert not row.passed

    def test_a_quota_error_is_excluded_from_the_denominator(self):
        rows = [
            grade(case(id="a"), agent_result([{"quantity": "p", "value": 92.56, "unit": "min"}]), None),
            grade(case(id="b"), self._quota_result(), None),
        ]
        summary = summarise(rows)
        assert summary["graded"] == 1
        assert summary["errored"] == 1
        assert summary["accuracy"] == 1.0

    def test_any_error_status_is_not_reached_whatever_the_upstream_code(self):
        """Measured: a flaky model returned 503 "high demand", not 429.

        Narrowing the rule to quota codes scored three such cases as physics
        failures and took a 100% run to 0%.
        """
        result = agent_result([], status="error")
        result["trace"] = [
            {"type": "guardrail", "name": "plan_failed", "detail": '{"code":503,"status":"UNAVAILABLE"}'}
        ]
        row = grade(case(), result, None)
        assert row.error is not None
        assert "no answer" in row.error
        assert summarise([row])["graded"] == 0

    def test_insufficient_data_remains_a_graded_failure(self):
        """The agent answered, just not with a number — that is behaviour, not an outage."""
        row = grade(case(), agent_result([], status="insufficient_data"), None)
        assert row.error is None
        assert row.failure_reason == "status_insufficient_data"
        assert summarise([row])["graded"] == 1

    def test_a_refusal_remains_a_graded_failure(self):
        row = grade(case(), agent_result([], status="refused"), None)
        assert row.error is None
        assert summarise([row])["graded"] == 1


class _Row:
    """Minimal stand-in for a result row: observed_model only reads .model."""

    def __init__(self, model):
        self.model = model


def test_observed_model_promotes_what_the_agent_reported():
    # Regression: the run block recorded `args.model`, which is None unless
    # --model was passed, so committed results said "(default)" and did not
    # say what produced them. That is unreproducible, and misleading given
    # Google aliases one model string onto another at serve time.
    assert run_physics.observed_model([_Row("gemini-3-flash-preview")] * 3) == (
        "gemini-3-flash-preview"
    )


def test_observed_model_keeps_every_value_when_a_run_spans_models():
    rows = [_Row("gemini-3-flash-preview"), _Row("gemini-3.5-flash")]
    assert run_physics.observed_model(rows) == (
        "gemini-3-flash-preview, gemini-3.5-flash"
    )


def test_observed_model_is_none_when_nothing_was_recorded():
    # Every case errored before reaching the model, so there is nothing to
    # claim. None lets the caller fall back to args.model rather than invent.
    assert run_physics.observed_model([_Row(None), _Row("")]) is None
    assert run_physics.observed_model([]) is None
