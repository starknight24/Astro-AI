import math

import pytest

from orbital import (
    MU_EARTH,
    R_EARTH,
    escape_velocity,
    hohmann_transfer,
    orbital_period,
    orbital_velocity,
    specific_orbital_energy,
    vis_viva,
)

ALTITUDES = [0, 200, 400, 600, 800, 1000, 2000, 5000, 10_000, 20_000, 35_786]


# ---------- Reference tests ----------

def test_iss_period():
    assert orbital_period(400)["period_s"] == pytest.approx(5554, rel=0.005)


def test_leo_velocity():
    assert orbital_velocity(400)["velocity_kms"] == pytest.approx(7.669, rel=0.005)


def test_surface_escape_velocity():
    assert escape_velocity(0)["escape_velocity_kms"] == pytest.approx(11.19, rel=0.005)


def test_geo_period_sidereal_day():
    assert orbital_period(35_786)["period_s"] == pytest.approx(86_164, rel=0.002)


def test_hohmann_leo_to_geo_dv():
    r = hohmann_transfer(400, 35_786)
    dv_total = abs(r["delta_v1_kms"]) + abs(r["delta_v2_kms"])
    assert dv_total == pytest.approx(3.85, rel=0.01)


def test_hohmann_leo_to_geo_time():
    r = hohmann_transfer(400, 35_786)
    hours = r["transfer_time_s"] / 3600
    assert hours == pytest.approx(5.3, rel=0.01)


# ---------- Property tests ----------

@pytest.mark.parametrize("h", ALTITUDES)
def test_escape_is_sqrt2_times_orbital(h):
    v_orb = orbital_velocity(h)["velocity_kms"]
    v_esc = escape_velocity(h)["escape_velocity_kms"]
    assert v_esc == pytest.approx(math.sqrt(2) * v_orb, rel=1e-12)


@pytest.mark.parametrize("h", ALTITUDES)
def test_vis_viva_circular_matches_orbital(h):
    a = R_EARTH + h
    v_vv = vis_viva(h, a)["velocity_kms"]
    v_orb = orbital_velocity(h)["velocity_kms"]
    assert v_vv == pytest.approx(v_orb, rel=1e-12)


@pytest.mark.parametrize("h", ALTITUDES)
def test_bound_orbit_energy_negative(h):
    a = R_EARTH + h
    eps = specific_orbital_energy(a)["specific_energy_kms2"]
    assert eps < 0


@pytest.mark.parametrize("h", ALTITUDES)
def test_energy_matches_vis_viva_form(h):
    a = R_EARTH + h
    r = a
    v = orbital_velocity(h)["velocity_kms"]
    eps_formula = v**2 / 2 - MU_EARTH / r
    eps_direct = specific_orbital_energy(a)["specific_energy_kms2"]
    assert eps_direct == pytest.approx(eps_formula, rel=1e-12)


@pytest.mark.parametrize(
    "a,b",
    [(200, 400), (400, 2000), (400, 35_786), (1000, 20_000), (500, 10_000)],
)
def test_hohmann_symmetric(a, b):
    up = hohmann_transfer(a, b)
    down = hohmann_transfer(b, a)
    dv_up = abs(up["delta_v1_kms"]) + abs(up["delta_v2_kms"])
    dv_down = abs(down["delta_v1_kms"]) + abs(down["delta_v2_kms"])
    assert dv_up == pytest.approx(dv_down, rel=1e-12)


def test_period_monotonic_in_altitude():
    periods = [orbital_period(h)["period_s"] for h in ALTITUDES]
    assert all(b > a for a, b in zip(periods, periods[1:]))


@pytest.mark.parametrize(
    "fn", [orbital_period, orbital_velocity, escape_velocity],
)
def test_negative_altitude_raises(fn):
    with pytest.raises(ValueError):
        fn(-100)


def test_vis_viva_bad_input_raises():
    with pytest.raises(ValueError):
        vis_viva(-100, 7000)
    with pytest.raises(ValueError):
        vis_viva(400, 0)


def test_specific_energy_bad_input_raises():
    with pytest.raises(ValueError):
        specific_orbital_energy(0)


def test_hohmann_bad_input_raises():
    with pytest.raises(ValueError):
        hohmann_transfer(-1, 400)
    with pytest.raises(ValueError):
        hohmann_transfer(400, -1)
