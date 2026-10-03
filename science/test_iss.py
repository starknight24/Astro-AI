"""ISS propagation tests. No network: every case injects the fixture TLE below.

The reference position is not self-generated — it was cross-checked against
api.wheretheiss.at (an independent SGP4 implementation) at capture time and
agreed to 0.1 km, so this is a regression test against an outside source in the
same spirit as the textbook/NASA values in test_orbital.py.
"""
import math
from datetime import datetime, timedelta, timezone

import pytest

import iss
from orbital import orbital_period

# ISS (ZARYA), Celestrak, epoch 26273.46514106 (2026-09-30T11:09:48Z)
FIXTURE_L1 = "1 25544U 98067A   26273.46514106  .00003651  00000+0  75169-4 0  9993"
FIXTURE_L2 = "2 25544  51.6316 139.0707 0007017 206.1646 153.8989 15.48696172588071"

# Verified against api.wheretheiss.at at capture time.
REF_TIME = datetime(2026, 9, 30, 22, 54, 55, tzinfo=timezone.utc)
REF_LAT, REF_LON, REF_ALT_KM = -24.6649, -15.5864, 422.7

TORONTO = (43.6532, -79.3832, 76.0)


@pytest.fixture
def tle() -> iss.Tle:
    return iss.parse_tle(f"ISS (ZARYA)\n{FIXTURE_L1}\n{FIXTURE_L2}")


@pytest.fixture
def sat(tle):
    return iss.satrec_from_tle(tle)


# ---------- TLE parsing ----------

def test_parse_three_line_tle(tle):
    assert tle.name == "ISS (ZARYA)"
    assert tle.line1.startswith("1 25544U")
    assert tle.epoch_line == "26273.46514106"


def test_parse_two_line_tle():
    parsed = iss.parse_tle(f"{FIXTURE_L1}\n{FIXTURE_L2}")
    assert parsed.line1 == FIXTURE_L1
    assert parsed.line2 == FIXTURE_L2


@pytest.mark.parametrize("junk", ["", "not a tle", "1 short\n2 short"])
def test_parse_rejects_junk(junk):
    with pytest.raises(ValueError):
        iss.parse_tle(junk)


# ---------- Frames ----------

def test_gmst_at_j2000_epoch():
    """GMST at the J2000 epoch is 280.46061837 deg (IAU standard value)."""
    g = iss.gmst_rad(datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc))
    assert math.degrees(g) == pytest.approx(280.46061837, abs=1e-4)


def test_gmst_advances_one_sidereal_day():
    t0 = datetime(2026, 3, 1, 0, 0, 0, tzinfo=timezone.utc)
    # A sidereal day is 23h56m04.0905s; GMST returns to the same value.
    t1 = t0 + timedelta(seconds=86164.0905)
    assert iss.gmst_rad(t1) == pytest.approx(iss.gmst_rad(t0), abs=1e-6)


@pytest.mark.parametrize(
    "lat,lon,h_m",
    [(43.6532, -79.3832, 76.0), (0.0, 0.0, 0.0), (-33.8688, 151.2093, 58.0), (89.0, 10.0, 0.0)],
)
def test_geodetic_ecef_round_trip(lat, lon, h_m):
    back = iss.ecef_to_geodetic(iss.site_ecef_km(lat, lon, h_m))
    assert back[0] == pytest.approx(lat, abs=1e-9)
    assert back[1] == pytest.approx(lon, abs=1e-9)
    assert back[2] * 1000 == pytest.approx(h_m, abs=1e-3)


def test_overhead_satellite_has_90_degree_elevation():
    """A point straight up from a site must read elevation 90 deg."""
    lat, lon, h = TORONTO
    zenith = iss.site_ecef_km(lat, lon, h + 400_000)  # 400 km overhead
    elev, _az, rng = iss.look_angles(zenith, lat, lon, h)
    assert elev == pytest.approx(90.0, abs=1e-6)
    assert rng == pytest.approx(400.0, rel=1e-6)


def test_azimuth_points_north_for_a_northward_offset():
    lat, lon, h = 0.0, 0.0, 0.0
    north_of_site = iss.site_ecef_km(10.0, 0.0, 400_000)
    _elev, az, _rng = iss.look_angles(north_of_site, lat, lon, h)
    assert az == pytest.approx(0.0, abs=1.0)


# ---------- Propagation ----------

def test_position_matches_independent_reference(sat, tle):
    pos = iss.position_at(sat, tle, REF_TIME)
    assert pos["latitude_deg"] == pytest.approx(REF_LAT, abs=0.05)
    assert pos["longitude_deg"] == pytest.approx(REF_LON, abs=0.05)
    assert pos["altitude_km"] == pytest.approx(REF_ALT_KM, abs=1.0)


def test_position_cites_its_source(sat, tle):
    pos = iss.position_at(sat, tle, REF_TIME)
    assert pos["norad_id"] == 25544
    assert pos["tle_epoch"] == "26273.46514106"
    assert "SGP4" in pos["source"]


@pytest.mark.parametrize("minutes", [0, 7, 31, 93, 400, 1440])
def test_altitude_stays_in_iss_band(sat, minutes):
    """The ISS orbit is near-circular at ~400-430 km; propagation must stay there."""
    when = REF_TIME + timedelta(minutes=minutes)
    _lat, _lon, alt = iss.ecef_to_geodetic(iss.teme_to_ecef(iss.propagate(sat, when), when))
    assert 380.0 < alt < 460.0


@pytest.mark.parametrize("minutes", [0, 13, 47, 120, 800])
def test_latitude_bounded_by_inclination(sat, minutes):
    when = REF_TIME + timedelta(minutes=minutes)
    lat, _lon, _alt = iss.ecef_to_geodetic(iss.teme_to_ecef(iss.propagate(sat, when), when))
    assert abs(lat) <= 51.7


def test_sgp4_period_agrees_with_kepler_engine(sat):
    """Cross-check the propagator against orbital.py: same orbit, same period.

    SGP4's mean motion and Kepler's third law are independent routes to the
    period, so agreement to <1% means the two engines describe one orbit.
    """
    period_min_sgp4 = 2 * math.pi / sat.no_kozai
    mean_alt_km = 422.0
    period_min_kepler = orbital_period(mean_alt_km)["period_min"]
    assert period_min_sgp4 == pytest.approx(period_min_kepler, rel=0.01)


# ---------- Pass prediction ----------

def test_next_passes_over_toronto_are_physically_sane(sat, tle):
    lat, lon, h = TORONTO
    result = iss.next_passes(sat, tle, lat, lon, h, start=REF_TIME, days=2.0, min_elevation_deg=10.0)
    assert result["pass_count"] >= 2
    for p in result["passes"]:
        assert 10.0 <= p["max_elevation_deg"] <= 90.0
        # Above 10 deg the ISS is in view for roughly 2-11 minutes.
        assert 1.0 <= p["duration_min"] <= 11.0
        # Slant range at peak can never be shorter than the orbital altitude.
        assert 380.0 <= p["peak_range_km"] <= 2200.0
        assert p["rise_utc"] < p["peak_utc"] < p["set_utc"]
        assert p["compass_at_peak"] in iss._COMPASS


def test_passes_are_chronological_and_start_after_search_start(sat, tle):
    lat, lon, h = TORONTO
    result = iss.next_passes(sat, tle, lat, lon, h, start=REF_TIME, days=2.0)
    rises = [p["rise_utc"] for p in result["passes"]]
    assert rises == sorted(rises)
    assert all(r >= result["search_start_utc"] for r in rises)


def test_higher_minimum_elevation_yields_fewer_passes(sat, tle):
    lat, lon, h = TORONTO
    low = iss.next_passes(sat, tle, lat, lon, h, start=REF_TIME, days=2.0, min_elevation_deg=10.0)
    high = iss.next_passes(sat, tle, lat, lon, h, start=REF_TIME, days=2.0, min_elevation_deg=45.0)
    assert high["pass_count"] <= low["pass_count"]


def test_no_passes_at_a_latitude_the_iss_never_reaches(sat, tle):
    """The ISS never rises 10 deg above the horizon at the South Pole."""
    result = iss.next_passes(sat, tle, -89.9, 0.0, 0.0, start=REF_TIME, days=2.0, min_elevation_deg=10.0)
    assert result["pass_count"] == 0


def test_pass_record_carries_tle_provenance(sat, tle):
    lat, lon, h = TORONTO
    result = iss.next_passes(sat, tle, lat, lon, h, start=REF_TIME, days=1.0)
    assert result["tle_epoch"] == "26273.46514106"
    assert result["norad_id"] == 25544
    assert "SGP4" in result["method"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"lat_deg": 91.0},
        {"lat_deg": -91.0},
        {"lon_deg": 181.0},
        {"lon_deg": -181.0},
        {"min_elevation_deg": 90.0},
        {"min_elevation_deg": -1.0},
        {"days": 0.0},
        {"days": 11.0},
    ],
)
def test_next_passes_rejects_out_of_range_arguments(sat, tle, kwargs):
    args = {"lat_deg": 43.6532, "lon_deg": -79.3832, "elevation_m": 76.0, "days": 1.0}
    args.update(kwargs)
    with pytest.raises(ValueError):
        iss.next_passes(sat, tle, start=REF_TIME, **args)
