"""Generate the physics golden dataset from the deterministic engine.

    python3 evals/build_physics_dataset.py

The point of the whole eval story (ADR-003): expected answers are **computed by
`science/orbital.py`**, never typed in by hand. A hand-written answer key would
make the harness grade the LLM against my arithmetic, and my arithmetic is not
the ground truth the product promises. Here the key is produced by the same
function the agent's tool calls, so a disagreement is unambiguously the model's.

Each question states its units explicitly, because ambiguous units are a
failure mode of their own (see docs/failure-modes.md) and this set is meant to
measure physics accuracy, not unit guessing.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import _path  # noqa: F401  (sys.path side effect)

from orbital import (  # noqa: E402
    MU_EARTH,
    R_EARTH,
    escape_velocity,
    hohmann_transfer,
    orbital_period,
    orbital_velocity,
    specific_orbital_energy,
    vis_viva,
)

OUT = Path(__file__).parent / "datasets" / "physics_golden.json"

# Relative tolerance per topic.
#
# 1% everywhere except Hohmann delta-v. Rationale: the agent reports what the
# engine returns, so a correct run matches to many digits and the tolerance only
# has to absorb the rounding the model applies when writing prose ("5553.62 s").
# 1% is roughly two significant figures of slack — tight enough that a wrong
# formula or a missed R_earth cannot pass, loose enough that sensible rounding
# does not fail.
#
# Hohmann gets 2%: its answer is a difference of two similar velocities, so the
# same absolute rounding is a larger relative error.
DEFAULT_TOLERANCE = 0.01
HOHMANN_TOLERANCE = 0.02

# Altitudes chosen to span the regimes a student meets, including the two that
# catch the classic errors: 0 km (is R_earth handled?) and 35786 km (does GEO
# come out at a sidereal day?).
LEO = [200, 400, 600, 800, 1000]
MEO = [2000, 5000, 10_000, 20_000]
GEO = 35_786


def case(
    question: str,
    value: float,
    unit: str,
    topic: str,
    difficulty: str,
    derivation: str,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict[str, Any]:
    return {
        "question": question,
        "expected_value": round(value, 6),
        "expected_unit": unit,
        "tolerance": tolerance,
        "topic": topic,
        "difficulty": difficulty,
        # Recorded so a disputed answer can be re-derived without guessing which
        # engine call produced it.
        "derivation": derivation,
    }


def build() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    # ---- Orbital period (10) -------------------------------------------------
    for alt in LEO + MEO:
        result = orbital_period(alt)
        cases.append(
            case(
                f"What is the orbital period, in minutes, of a satellite in a circular orbit "
                f"at an altitude of {alt:,} km above Earth's surface?",
                result["period_min"],
                "min",
                "orbital_period",
                "easy" if alt in LEO else "medium",
                f"orbital_period({alt})['period_min']",
            )
        )
    geo = orbital_period(GEO)
    cases.append(
        case(
            "What is the orbital period, in hours, of a satellite in a circular orbit at an "
            "altitude of 35,786 km above Earth's surface?",
            geo["period_s"] / 3600,
            "h",
            "orbital_period",
            "medium",
            "orbital_period(35786)['period_s'] / 3600",
        )
    )

    # ---- Orbital velocity (8) -----------------------------------------------
    for alt in LEO + MEO[:3]:
        result = orbital_velocity(alt)
        cases.append(
            case(
                f"What is the orbital speed, in km/s, of a satellite in a circular orbit at "
                f"an altitude of {alt:,} km above Earth's surface?",
                result["velocity_kms"],
                "km/s",
                "orbital_velocity",
                "easy",
                f"orbital_velocity({alt})['velocity_kms']",
            )
        )

    # ---- Escape velocity (6) ------------------------------------------------
    for alt in [0, 200, 400, 1000, 10_000, GEO]:
        result = escape_velocity(alt)
        cases.append(
            case(
                f"What is the escape velocity, in km/s, from an altitude of {alt:,} km above "
                f"Earth's surface?",
                result["escape_velocity_kms"],
                "km/s",
                "escape_velocity",
                "easy" if alt == 0 else "medium",
                f"escape_velocity({alt})['escape_velocity_kms']",
            )
        )

    # ---- Vis-viva (8) -------------------------------------------------------
    # Elliptical orbits given as perigee/apogee altitudes, which is how a
    # student meets them; the semi-major axis has to be derived first.
    for perigee, apogee in [(200, 35_786), (400, 35_786), (300, 1000), (500, 20_000)]:
        a = R_EARTH + (perigee + apogee) / 2
        for label, alt in (("perigee", perigee), ("apogee", apogee)):
            result = vis_viva(alt, a)
            cases.append(
                case(
                    f"A satellite is in an elliptical orbit with a perigee altitude of "
                    f"{perigee:,} km and an apogee altitude of {apogee:,} km. What is its "
                    f"speed, in km/s, at {label}?",
                    result["velocity_kms"],
                    "km/s",
                    "vis_viva",
                    "hard",
                    f"vis_viva({alt}, {a})['velocity_kms']  # a = R_EARTH + ({perigee}+{apogee})/2",
                )
            )

    # ---- Specific orbital energy (6) ----------------------------------------
    for alt in [200, 400, 1000, 5000, 20_000, GEO]:
        a = R_EARTH + alt
        result = specific_orbital_energy(a)
        cases.append(
            case(
                f"What is the specific orbital energy, in km^2/s^2, of a circular orbit at an "
                f"altitude of {alt:,} km above Earth's surface?",
                result["specific_energy_kms2"],
                "km^2/s^2",
                "specific_orbital_energy",
                "medium",
                f"specific_orbital_energy({a})['specific_energy_kms2']",
            )
        )

    # ---- Hohmann transfer (16) ----------------------------------------------
    transfers = [
        (200, 35_786, "easy"),
        (400, 35_786, "easy"),
        (300, 1000, "medium"),
        (500, 20_000, "medium"),
        (1000, 400, "hard"),  # descending: the delta-vs are negative
        (400, 800, "medium"),
        (200, 400, "hard"),  # small ratio: tiny delta-v, easy to get wrong
        (400, 384_400, "hard"),  # lunar distance
    ]
    for alt1, alt2, difficulty in transfers:
        result = hohmann_transfer(alt1, alt2)
        total = abs(result["delta_v1_kms"]) + abs(result["delta_v2_kms"])
        cases.append(
            case(
                f"What is the total delta-v, in km/s, for a Hohmann transfer from a circular "
                f"orbit at {alt1:,} km altitude to a circular orbit at {alt2:,} km altitude?",
                total,
                "km/s",
                "hohmann_transfer",
                difficulty,
                f"abs(hohmann_transfer({alt1}, {alt2})['delta_v1_kms']) + abs(...['delta_v2_kms'])",
                tolerance=HOHMANN_TOLERANCE,
            )
        )
        cases.append(
            case(
                f"How long, in hours, does a Hohmann transfer from a circular orbit at "
                f"{alt1:,} km altitude to a circular orbit at {alt2:,} km altitude take?",
                result["transfer_time_s"] / 3600,
                "h",
                "hohmann_transfer",
                difficulty,
                f"hohmann_transfer({alt1}, {alt2})['transfer_time_s'] / 3600",
            )
        )

    # ---- Derived / multi-step (6) -------------------------------------------
    # Questions whose answer needs two engine calls or a conversion, to catch an
    # agent that can call one tool but cannot compose two.
    iss = orbital_period(400)
    cases.append(
        case(
            # Wording fixed after the first eval run: the original asked for
            # "complete orbits", for which 15 is the correct answer, while the
            # expected value was the unrounded 15.557. The question and the key
            # disagreed, and the agent was marked wrong for being right.
            "A satellite is in a circular orbit at 400 km altitude. How many orbits does it "
            "make in 24 hours? Give the exact fractional number of orbits, not a whole number.",
            86_400 / iss["period_s"],
            "orbits",
            "derived",
            "hard",
            "86400 / orbital_period(400)['period_s']",
        )
    )
    v400 = orbital_velocity(400)["velocity_kms"]
    cases.append(
        case(
            "What is the orbital speed, in km/h, of a satellite in a circular orbit at 400 km "
            "altitude above Earth's surface?",
            v400 * 3600,
            "km/h",
            "derived",
            "medium",
            "orbital_velocity(400)['velocity_kms'] * 3600",
        )
    )
    cases.append(
        case(
            "By how much, in km/s, does the escape velocity at 400 km altitude exceed the "
            "circular orbital speed at the same altitude?",
            escape_velocity(400)["escape_velocity_kms"] - v400,
            "km/s",
            "derived",
            "hard",
            "escape_velocity(400)[...] - orbital_velocity(400)[...]",
        )
    )
    cases.append(
        case(
            "What is the semi-major axis, in km, of a circular orbit at an altitude of 400 km "
            "above Earth's surface?",
            orbital_period(400)["semi_major_axis_km"],
            "km",
            "derived",
            "easy",
            "orbital_period(400)['semi_major_axis_km']",
        )
    )
    geo_transfer = hohmann_transfer(400, 35_786)
    cases.append(
        case(
            "For a Hohmann transfer from 400 km altitude to geostationary altitude "
            "(35,786 km), what is the magnitude of the first burn, in km/s?",
            abs(geo_transfer["delta_v1_kms"]),
            "km/s",
            "hohmann_transfer",
            "medium",
            "abs(hohmann_transfer(400, 35786)['delta_v1_kms'])",
            tolerance=HOHMANN_TOLERANCE,
        )
    )
    cases.append(
        case(
            "Earth's standard gravitational parameter is 398,600.4418 km^3/s^2. What is the "
            "orbital period, in minutes, of a circular orbit whose semi-major axis is "
            "exactly 7,000 km?",
            2 * 3.141592653589793 * ((7000**3 / MU_EARTH) ** 0.5) / 60,
            "min",
            "orbital_period",
            "hard",
            "T = 2*pi*sqrt(a^3/mu) with a = 7000 km, directly",
        )
    )

    for index, item in enumerate(cases, start=1):
        item["id"] = f"phys-{index:03d}"
    return cases


def main() -> None:
    cases = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, indent=1) + "\n", encoding="utf-8")

    topics: dict[str, int] = {}
    difficulties: dict[str, int] = {}
    for c in cases:
        topics[c["topic"]] = topics.get(c["topic"], 0) + 1
        difficulties[c["difficulty"]] = difficulties.get(c["difficulty"], 0) + 1
    print(f"wrote {OUT} with {len(cases)} cases")
    print("  by topic     :", dict(sorted(topics.items())))
    print("  by difficulty:", dict(sorted(difficulties.items())))


if __name__ == "__main__":
    main()
