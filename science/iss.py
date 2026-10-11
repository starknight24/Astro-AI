"""ISS position and ground-station pass prediction from TLEs.

DECISION (ADR-003, recorded in ADR-005): the six textbook formulas in
`orbital.py` are hand-written on purpose. Orbital *propagation* is not — SGP4 is
a specified model whose only correct implementation is the reference one, so this
module uses the `sgp4` package and hand-writes only the coordinate frames
(Vallado, 'Fundamentals of Astrodynamics and Applications', ch. 3-4):

    SGP4 -> TEME  --GMST rotation-->  ECEF  --site SEZ-->  elevation/azimuth

Polar motion (TEME->PEF->ITRF) is skipped: it shifts the ground track by metres,
which is irrelevant next to a pass window measured in minutes.

Units: km, seconds, degrees. Times are timezone-aware UTC datetimes.
"""
from __future__ import annotations

import math
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sgp4.api import Satrec, jday

ISS_NORAD_ID = 25544

# Celestrak's GP query, the canonical public source for ISS elements. No API key.
TLE_URL = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={ISS_NORAD_ID}&FORMAT=TLE"
TLE_FETCH_TIMEOUT_S = 8.0


def _tls_context() -> ssl.SSLContext:
    """A verifying TLS context that works off a bundled CA set when there is one.

    Python on macOS does not necessarily have a usable system trust store --
    a fresh virtualenv fails every HTTPS fetch with CERTIFICATE_VERIFY_FAILED
    until the interpreter's own cert installer is run. certifi ships with the
    dependency tree, so prefer it and fall back to the system default rather
    than making the TLE fetch depend on how the host was set up.

    Verification is never disabled: a silently unverified fetch would make the
    engine's ground truth attacker-controlled.
    """
    try:
        import certifi
    except ModuleNotFoundError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())

# TLEs are refreshed a few times a day and stay usable for days; an hour-long
# cache keeps Celestrak untouched across a burst of agent calls.
TLE_TTL_S = 3600.0

R_EARTH_EQ_KM = 6378.137        # WGS-84 semi-major axis
EARTH_FLATTENING = 1 / 298.257223563

# Pass-scan resolution. The ISS crosses the sky in ~10 min, so a 30 s coarse step
# cannot miss a pass; boundaries are then refined by bisection to ~1 s.
COARSE_STEP_S = 30
REFINE_ITERATIONS = 6
DEFAULT_MIN_ELEVATION_DEG = 10.0


class TleUnavailable(RuntimeError):
    """Raised when no TLE could be fetched and none is cached."""


@dataclass(frozen=True)
class Tle:
    line1: str
    line2: str
    name: str
    fetched_at: datetime

    @property
    def epoch_line(self) -> str:
        """The TLE's own epoch field — cited so callers can see the element age."""
        return self.line1[18:32].strip()


# ---------- TLE acquisition ----------

_tle_cache: tuple[Tle, float] | None = None  # (tle, monotonic-ish unix seconds)


def parse_tle(text: str) -> Tle:
    """Parse a 2- or 3-line TLE block."""
    lines = [ln.rstrip() for ln in text.strip().splitlines() if ln.strip()]
    if len(lines) >= 3 and lines[1].startswith("1 ") and lines[2].startswith("2 "):
        name, line1, line2 = lines[0].strip(), lines[1], lines[2]
    elif len(lines) >= 2 and lines[0].startswith("1 ") and lines[1].startswith("2 "):
        name, line1, line2 = f"NORAD {ISS_NORAD_ID}", lines[0], lines[1]
    else:
        raise ValueError("Unrecognised TLE format")
    if len(line1) < 69 or len(line2) < 69:
        raise ValueError("TLE lines are too short to be valid")
    return Tle(line1=line1, line2=line2, name=name, fetched_at=_utcnow())


def fetch_tle(force: bool = False) -> Tle:
    """Return the ISS TLE, from cache when fresh.

    On a fetch failure a stale cached TLE is returned rather than raising: a
    two-day-old element set still predicts passes to within seconds, and a
    degraded answer beats no answer. Only a cold cache raises.
    """
    global _tle_cache
    now = _utcnow().timestamp()
    if not force and _tle_cache is not None and now - _tle_cache[1] < TLE_TTL_S:
        return _tle_cache[0]
    try:
        req = urllib.request.Request(TLE_URL, headers={"User-Agent": "AstroAI/1.0"})
        with urllib.request.urlopen(
            req, timeout=TLE_FETCH_TIMEOUT_S, context=_tls_context()
        ) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        tle = parse_tle(text)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        if _tle_cache is not None:
            return _tle_cache[0]
        raise TleUnavailable(f"Could not fetch ISS TLE: {exc}") from exc
    _tle_cache = (tle, now)
    return tle


def satrec_from_tle(tle: Tle) -> Satrec:
    return Satrec.twoline2rv(tle.line1, tle.line2)


# ---------- Frames ----------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def gmst_rad(when: datetime) -> float:
    """Greenwich mean sidereal time (radians), IAU-1982 series."""
    jd, fr = jday(
        when.year, when.month, when.day,
        when.hour, when.minute, when.second + when.microsecond / 1e6,
    )
    t = ((jd - 2451545.0) + fr) / 36525.0
    seconds = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * t
        + 0.093104 * t * t
        - 6.2e-6 * t * t * t
    )
    return math.radians((seconds % 86400.0) / 240.0) % (2 * math.pi)


def teme_to_ecef(r_teme_km: tuple[float, float, float], when: datetime) -> tuple[float, float, float]:
    """Rotate TEME into an Earth-fixed frame about the pole by -GMST."""
    theta = gmst_rad(when)
    x, y, z = r_teme_km
    return (
        x * math.cos(theta) + y * math.sin(theta),
        -x * math.sin(theta) + y * math.cos(theta),
        z,
    )


def ecef_to_geodetic(r_ecef_km: tuple[float, float, float]) -> tuple[float, float, float]:
    """ECEF -> (lat_deg, lon_deg, altitude_km) on the WGS-84 ellipsoid.

    Standard fixed-point iteration on latitude; converges to sub-millimetre for
    near-Earth orbits in a handful of passes.
    """
    x, y, z = r_ecef_km
    a = R_EARTH_EQ_KM
    e2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING)
    lon = math.atan2(y, x)
    p = math.hypot(x, y)
    if p < 1e-9:  # over a pole
        return math.copysign(90.0, z), 0.0, abs(z) - a * (1 - EARTH_FLATTENING)
    lat = math.atan2(z, p * (1 - e2))
    alt = 0.0
    for _ in range(8):
        n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        alt = p / math.cos(lat) - n
        lat = math.atan2(z, p * (1 - e2 * n / (n + alt)))
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    alt = p / math.cos(lat) - n
    return math.degrees(lat), (math.degrees(lon) + 540.0) % 360.0 - 180.0, alt


def site_ecef_km(lat_deg: float, lon_deg: float, elevation_m: float = 0.0) -> tuple[float, float, float]:
    """Geodetic ground site -> ECEF position (km)."""
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    h = elevation_m / 1000.0
    a = R_EARTH_EQ_KM
    e2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return (
        (n + h) * math.cos(lat) * math.cos(lon),
        (n + h) * math.cos(lat) * math.sin(lon),
        (n * (1 - e2) + h) * math.sin(lat),
    )


def look_angles(
    r_sat_ecef_km: tuple[float, float, float],
    lat_deg: float,
    lon_deg: float,
    elevation_m: float = 0.0,
) -> tuple[float, float, float]:
    """Topocentric (elevation_deg, azimuth_deg, range_km) of a satellite from a site."""
    sx, sy, sz = site_ecef_km(lat_deg, lon_deg, elevation_m)
    dx, dy, dz = r_sat_ecef_km[0] - sx, r_sat_ecef_km[1] - sy, r_sat_ecef_km[2] - sz
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    sin_lon, cos_lon = math.sin(lon), math.cos(lon)
    # ECEF -> SEZ (south, east, zenith)
    south = sin_lat * cos_lon * dx + sin_lat * sin_lon * dy - cos_lat * dz
    east = -sin_lon * dx + cos_lon * dy
    zenith = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz
    rng = math.sqrt(south * south + east * east + zenith * zenith)
    elev = math.degrees(math.asin(max(-1.0, min(1.0, zenith / rng))))
    az = (math.degrees(math.atan2(east, -south)) + 360.0) % 360.0
    return elev, az, rng


# ---------- Propagation ----------

def propagate(sat: Satrec, when: datetime) -> tuple[float, float, float]:
    """TEME position (km) at `when`. Raises ValueError on an SGP4 error code."""
    jd, fr = jday(
        when.year, when.month, when.day,
        when.hour, when.minute, when.second + when.microsecond / 1e6,
    )
    err, r, _v = sat.sgp4(jd, fr)
    if err != 0:
        raise ValueError(f"SGP4 propagation failed (code {err}) at {when.isoformat()}")
    return r


def position_at(sat: Satrec, tle: Tle, when: datetime) -> dict:
    """Sub-satellite point and altitude at `when`."""
    r_teme = propagate(sat, when)
    r_ecef = teme_to_ecef(r_teme, when)
    lat, lon, alt = ecef_to_geodetic(r_ecef)
    return {
        "timestamp_utc": when.replace(microsecond=0).isoformat(),
        "latitude_deg": round(lat, 4),
        "longitude_deg": round(lon, 4),
        "altitude_km": round(alt, 2),
        "source": "SGP4 propagation of Celestrak TLE",
        "tle_epoch": tle.epoch_line,
        "tle_fetched_at": tle.fetched_at.replace(microsecond=0).isoformat(),
        "norad_id": ISS_NORAD_ID,
    }


def _elevation_at(sat: Satrec, when: datetime, lat: float, lon: float, elev_m: float) -> float:
    return look_angles(teme_to_ecef(propagate(sat, when), when), lat, lon, elev_m)[0]


def _refine_crossing(
    sat: Satrec,
    below: datetime,
    above: datetime,
    lat: float,
    lon: float,
    elev_m: float,
    threshold: float,
) -> datetime:
    """Bisect between a below-threshold and an above-threshold time."""
    lo, hi = below, above
    for _ in range(REFINE_ITERATIONS):
        mid = lo + (hi - lo) / 2
        if _elevation_at(sat, mid, lat, lon, elev_m) >= threshold:
            hi = mid
        else:
            lo = mid
    return hi


def next_passes(
    sat: Satrec,
    tle: Tle,
    lat_deg: float,
    lon_deg: float,
    elevation_m: float = 0.0,
    start: datetime | None = None,
    days: float = 2.0,
    min_elevation_deg: float = DEFAULT_MIN_ELEVATION_DEG,
    max_passes: int = 5,
) -> dict:
    """Scan forward for passes clearing `min_elevation_deg` above the horizon."""
    if not -90.0 <= lat_deg <= 90.0:
        raise ValueError("lat_deg must be between -90 and 90")
    if not -180.0 <= lon_deg <= 180.0:
        raise ValueError("lon_deg must be between -180 and 180")
    if not 0.0 <= min_elevation_deg < 90.0:
        raise ValueError("min_elevation_deg must be in [0, 90)")
    if not 0.0 < days <= 10.0:
        raise ValueError("days must be in (0, 10]")

    t0 = (start or _utcnow()).astimezone(timezone.utc)
    horizon = t0 + timedelta(days=days)
    step = timedelta(seconds=COARSE_STEP_S)

    passes: list[dict] = []
    t = t0
    prev_t, prev_elev = t, _elevation_at(sat, t, lat_deg, lon_deg, elevation_m)
    # A scan that begins mid-pass is reported from t0, flagged `in_progress`.
    in_pass = prev_elev >= min_elevation_deg
    rise_t = t0 if in_pass else None
    peak_t, peak_elev = (t0, prev_elev) if in_pass else (None, -90.0)
    started_in_pass = in_pass

    while t < horizon and len(passes) < max_passes:
        t = t + step
        elev = _elevation_at(sat, t, lat_deg, lon_deg, elevation_m)

        if not in_pass and elev >= min_elevation_deg:
            in_pass = True
            rise_t = _refine_crossing(sat, prev_t, t, lat_deg, lon_deg, elevation_m, min_elevation_deg)
            peak_t, peak_elev = t, elev
        elif in_pass:
            if elev > peak_elev:
                peak_t, peak_elev = t, elev
            if elev < min_elevation_deg:
                set_t = _refine_crossing(sat, t, prev_t, lat_deg, lon_deg, elevation_m, min_elevation_deg)
                passes.append(
                    _describe_pass(
                        sat, rise_t, peak_t, set_t, lat_deg, lon_deg, elevation_m,
                        in_progress=started_in_pass and not passes,
                    )
                )
                in_pass = False
                rise_t, peak_t, peak_elev = None, None, -90.0
        prev_t, prev_elev = t, elev

    return {
        "site": {
            "latitude_deg": lat_deg,
            "longitude_deg": lon_deg,
            "elevation_m": elevation_m,
        },
        "search_start_utc": t0.replace(microsecond=0).isoformat(),
        "search_days": days,
        "min_elevation_deg": min_elevation_deg,
        "passes": passes,
        "pass_count": len(passes),
        "source": "SGP4 propagation of Celestrak TLE",
        "tle_epoch": tle.epoch_line,
        "tle_fetched_at": tle.fetched_at.replace(microsecond=0).isoformat(),
        "norad_id": ISS_NORAD_ID,
        "method": (
            "SGP4 -> TEME -> GMST rotation -> ECEF -> topocentric SEZ; "
            f"{COARSE_STEP_S}s scan with bisection refinement"
        ),
    }


def _describe_pass(
    sat: Satrec,
    rise_t: datetime,
    peak_t: datetime,
    set_t: datetime,
    lat: float,
    lon: float,
    elev_m: float,
    in_progress: bool,
) -> dict:
    """Refine the peak by golden-section-free local search and build the record."""
    # Peak from the coarse scan is within one step; re-sample at 1 s around it.
    best_t, best_elev = peak_t, _elevation_at(sat, peak_t, lat, lon, elev_m)
    for offset in range(-COARSE_STEP_S, COARSE_STEP_S + 1, 2):
        cand = peak_t + timedelta(seconds=offset)
        if not (rise_t <= cand <= set_t):
            continue
        e = _elevation_at(sat, cand, lat, lon, elev_m)
        if e > best_elev:
            best_t, best_elev = cand, e
    _, peak_az, peak_range = look_angles(
        teme_to_ecef(propagate(sat, best_t), best_t), lat, lon, elev_m
    )
    _, rise_az, _ = look_angles(teme_to_ecef(propagate(sat, rise_t), rise_t), lat, lon, elev_m)
    _, set_az, _ = look_angles(teme_to_ecef(propagate(sat, set_t), set_t), lat, lon, elev_m)
    return {
        "rise_utc": rise_t.replace(microsecond=0).isoformat(),
        "peak_utc": best_t.replace(microsecond=0).isoformat(),
        "set_utc": set_t.replace(microsecond=0).isoformat(),
        "duration_s": round((set_t - rise_t).total_seconds()),
        "duration_min": round((set_t - rise_t).total_seconds() / 60, 1),
        "max_elevation_deg": round(best_elev, 1),
        "rise_azimuth_deg": round(rise_az, 1),
        "peak_azimuth_deg": round(peak_az, 1),
        "set_azimuth_deg": round(set_az, 1),
        "peak_range_km": round(peak_range, 1),
        "compass_at_peak": _compass(peak_az),
        "in_progress_at_search_start": in_progress,
    }


_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _compass(azimuth_deg: float) -> str:
    return _COMPASS[int((azimuth_deg % 360) / 22.5 + 0.5) % 16]
