"""Deterministic orbital mechanics. Ground truth for AstroAI's eval harness.

Units convention (strict): distances in km, time in s, velocity in km/s.
All public functions take ALTITUDE above Earth's surface where noted,
and convert to orbital RADIUS internally.
Formulas: Curtis, 'Orbital Mechanics for Engineering Students'; constants: NASA/JPL.
"""
import math

MU_EARTH = 398_600.4418   # km^3/s^2 — Earth's standard gravitational parameter (GM)
R_EARTH  = 6_378.137      # km — Earth equatorial radius (WGS-84)

def orbital_period(altitude_km: float) -> dict:
    """Period of a circular orbit at the given altitude.

    T = 2π·sqrt(a³/μ)   (Kepler's third law; a = R_earth + altitude)
    """
    if altitude_km < 0:
        raise ValueError("altitude_km must be non-negative")
    a = R_EARTH + altitude_km
    period_s = 2 * math.pi * math.sqrt(a**3 / MU_EARTH)
    return {
        "period_s": period_s,
        "period_min": period_s / 60,
        "semi_major_axis_km": a,
        "formula": "T = 2π·√(a³/μ)",
    }