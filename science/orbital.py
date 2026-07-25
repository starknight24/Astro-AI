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

def orbital_velocity(altitude_km: float) -> dict:
    """Velocity of a circular orbit at the given altitude.

    v = sqrt(μ/a)   (circular orbit velocity)
    """
    if altitude_km < 0:
        raise ValueError("altitude_km must be non-negative")
    a = R_EARTH + altitude_km
    velocity_kms = math.sqrt(MU_EARTH / a)
    return {
        "velocity_kms": velocity_kms,
        "velocity_kmh": velocity_kms * 3600,
        "semi_major_axis_km": a,
        "formula": "v = √(μ/a)",
    }   

def escape_velocity(altitude_km: float) -> dict:
    """Escape velocity from the given altitude.

    v_esc = sqrt(2μ/a)   (escape velocity)
    """
    if altitude_km < 0:
        raise ValueError("altitude_km must be non-negative")
    a = R_EARTH + altitude_km
    escape_velocity_kms = math.sqrt(2 * MU_EARTH / a)
    return {
        "escape_velocity_kms": escape_velocity_kms,
        "escape_velocity_kmh": escape_velocity_kms * 3600,
        "semi_major_axis_km": a,
        "formula": "v_esc = √(2μ/a)",
    }

def vis_viva(altitude_km: float, semi_major_axis_km: float) -> dict:
    """Orbital velocity at a given altitude for an orbit with the given semi-major axis.

    v = sqrt(μ * (2/r - 1/a))   (vis-viva equation)
    """
    if altitude_km < 0:
        raise ValueError("altitude_km must be non-negative")
    if semi_major_axis_km <= 0:
        raise ValueError("semi_major_axis_km must be positive")
    r = R_EARTH + altitude_km
    velocity_kms = math.sqrt(MU_EARTH * (2 / r - 1 / semi_major_axis_km))
    return {
        "velocity_kms": velocity_kms,
        "velocity_kmh": velocity_kms * 3600,
        "radius_km": r,
        "semi_major_axis_km": semi_major_axis_km,
        "formula": "v = √(μ * (2/r - 1/a))",
    }

def specific_orbital_energy(semi_major_axis_km: float) -> dict:
    """Specific orbital energy for an orbit with the given semi-major axis.

    ε = -μ/(2a)   (specific orbital energy)
    """
    if semi_major_axis_km <= 0:
        raise ValueError("semi_major_axis_km must be positive")
    specific_energy_kms2 = -MU_EARTH / (2 * semi_major_axis_km)
    return {
        "specific_energy_kms2": specific_energy_kms2,
        "specific_energy_kmh2": specific_energy_kms2 * 3600**2,
        "semi_major_axis_km": semi_major_axis_km,
        "formula": "ε = -μ/(2a)",
    }

def hohmann_transfer(alt1_km, alt2_km: float) -> dict:
    """Hohmann transfer between two circular orbits at the given altitudes.

    Δv1 = sqrt(μ/r1) * (sqrt(2*r2/(r1+r2)) - 1)
    Δv2 = sqrt(μ/r2) * (1 - sqrt(2*r1/(r1+r2)))
    T_transfer = π * sqrt(((r1 + r2)/2)³ / μ)
    """
    if alt1_km < 0 or alt2_km < 0:
        raise ValueError("altitudes must be non-negative")
    r1 = R_EARTH + alt1_km
    r2 = R_EARTH + alt2_km
    delta_v1 = math.sqrt(MU_EARTH / r1) * (math.sqrt(2 * r2 / (r1 + r2)) - 1)
    delta_v2 = math.sqrt(MU_EARTH / r2) * (1 - math.sqrt(2 * r1 / (r1 + r2)))
    transfer_time_s = math.pi * math.sqrt(((r1 + r2) / 2)**3 / MU_EARTH)
    return {
        "delta_v1_kms": delta_v1,
        "delta_v2_kms": delta_v2,
        "transfer_time_s": transfer_time_s,
        "transfer_time_min": transfer_time_s / 60,
        "initial_radius_km": r1,
        "final_radius_km": r2,
        "formula_delta_v1": "Δv1 = √(μ/r1) * (√(2*r2/(r1+r2)) - 1)",
        "formula_delta_v2": "Δv2 = √(μ/r2) * (1 - √(2*r1/(r1+r2)))",
        "formula_transfer_time": "T_transfer = π * √(((r1 + r2)/2)³ / μ)",
    }

#Optional but needed at week 4 apogee_perigee_velocities(perigee_alt, apogee_alt) — two vis-viva calls