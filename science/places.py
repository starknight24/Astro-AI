"""Place-name -> coordinates. A curated gazetteer, deliberately not a geocoding API.

DECISION (ADR-005): the agent needs "over Toronto" to become a lat/lon. A live
geocoder (Nominatim/Google) would add a third external dependency, an API key,
and a rate limit to a tool that must answer in milliseconds. A static table of
the cities students actually ask about is smaller, free, offline, deterministic
(so eval runs are reproducible), and fails loudly: an unknown place returns an
error telling the caller to pass lat/lon explicitly, which the agent surfaces as
a clarifying question rather than guessing coordinates.
"""

# lat, lon in degrees (WGS-84); elevation in metres above the ellipsoid.
CITIES: dict[str, tuple[float, float, float]] = {
    "toronto": (43.6532, -79.3832, 76.0),
    "ottawa": (45.4215, -75.6972, 70.0),
    "montreal": (45.5019, -73.5674, 36.0),
    "vancouver": (49.2827, -123.1207, 4.0),
    "calgary": (51.0447, -114.0719, 1045.0),
    "edmonton": (53.5461, -113.4938, 645.0),
    "winnipeg": (49.8951, -97.1384, 239.0),
    "halifax": (44.6488, -63.5752, 15.0),
    "quebec city": (46.8139, -71.2080, 98.0),
    "new york": (40.7128, -74.0060, 10.0),
    "los angeles": (34.0522, -118.2437, 71.0),
    "chicago": (41.8781, -87.6298, 181.0),
    "houston": (29.7604, -95.3698, 24.0),
    "phoenix": (33.4484, -112.0740, 331.0),
    "seattle": (47.6062, -122.3321, 53.0),
    "san francisco": (37.7749, -122.4194, 16.0),
    "boston": (42.3601, -71.0589, 43.0),
    "denver": (39.7392, -104.9903, 1609.0),
    "miami": (25.7617, -80.1918, 2.0),
    "washington": (38.9072, -77.0369, 7.0),
    "atlanta": (33.7490, -84.3880, 320.0),
    "dallas": (32.7767, -96.7970, 131.0),
    "cape canaveral": (28.3922, -80.6077, 3.0),
    "pasadena": (34.1478, -118.1445, 263.0),
    "mexico city": (19.4326, -99.1332, 2240.0),
    "sao paulo": (-23.5505, -46.6333, 760.0),
    "rio de janeiro": (-22.9068, -43.1729, 2.0),
    "buenos aires": (-34.6037, -58.3816, 25.0),
    "santiago": (-33.4489, -70.6693, 570.0),
    "bogota": (4.7110, -74.0721, 2640.0),
    "london": (51.5074, -0.1278, 11.0),
    "paris": (48.8566, 2.3522, 35.0),
    "berlin": (52.5200, 13.4050, 34.0),
    "madrid": (40.4168, -3.7038, 667.0),
    "rome": (41.9028, 12.4964, 21.0),
    "amsterdam": (52.3676, 4.9041, -2.0),
    "zurich": (47.3769, 8.5417, 408.0),
    "stockholm": (59.3293, 18.0686, 28.0),
    "oslo": (59.9139, 10.7522, 23.0),
    "helsinki": (60.1699, 24.9384, 26.0),
    "copenhagen": (55.6761, 12.5683, 24.0),
    "dublin": (53.3498, -6.2603, 20.0),
    "lisbon": (38.7223, -9.1393, 2.0),
    "vienna": (48.2082, 16.3738, 193.0),
    "prague": (50.0755, 14.4378, 200.0),
    "warsaw": (52.2297, 21.0122, 113.0),
    "athens": (37.9838, 23.7275, 70.0),
    "moscow": (55.7558, 37.6173, 156.0),
    "istanbul": (41.0082, 28.9784, 39.0),
    "cairo": (30.0444, 31.2357, 23.0),
    "lagos": (6.5244, 3.3792, 41.0),
    "nairobi": (-1.2921, 36.8219, 1795.0),
    "johannesburg": (-26.2041, 28.0473, 1753.0),
    "cape town": (-33.9249, 18.4241, 25.0),
    "dubai": (25.2048, 55.2708, 5.0),
    "tel aviv": (32.0853, 34.7818, 34.0),
    "riyadh": (24.7136, 46.6753, 612.0),
    "mumbai": (19.0760, 72.8777, 14.0),
    "delhi": (28.6139, 77.2090, 216.0),
    "bengaluru": (12.9716, 77.5946, 920.0),
    "chennai": (13.0827, 80.2707, 6.0),
    "colombo": (6.9271, 79.8612, 1.0),
    "dhaka": (23.8103, 90.4125, 4.0),
    "karachi": (24.8607, 67.0011, 8.0),
    "bangkok": (13.7563, 100.5018, 1.0),
    "singapore": (1.3521, 103.8198, 15.0),
    "jakarta": (-6.2088, 106.8456, 8.0),
    "manila": (14.5995, 120.9842, 16.0),
    "hong kong": (22.3193, 114.1694, 14.0),
    "beijing": (39.9042, 116.4074, 44.0),
    "shanghai": (31.2304, 121.4737, 4.0),
    "seoul": (37.5665, 126.9780, 38.0),
    "tokyo": (35.6762, 139.6503, 40.0),
    "osaka": (34.6937, 135.5023, 12.0),
    "taipei": (25.0330, 121.5654, 9.0),
    "sydney": (-33.8688, 151.2093, 58.0),
    "melbourne": (-37.8136, 144.9631, 31.0),
    "brisbane": (-27.4698, 153.0251, 27.0),
    "perth": (-31.9523, 115.8613, 46.0),
    "auckland": (-36.8485, 174.7633, 196.0),
    "wellington": (-41.2866, 174.7756, 31.0),
    "reykjavik": (64.1466, -21.9426, 61.0),
    "anchorage": (61.2181, -149.9003, 31.0),
    "honolulu": (21.3069, -157.8583, 6.0),
}

# Common ways students name the same place.
ALIASES: dict[str, str] = {
    "nyc": "new york",
    "new york city": "new york",
    "la": "los angeles",
    "sf": "san francisco",
    "bay area": "san francisco",
    "dc": "washington",
    "washington dc": "washington",
    "washington, d.c.": "washington",
    "kennedy space center": "cape canaveral",
    "ksc": "cape canaveral",
    "jpl": "pasadena",
    "bangalore": "bengaluru",
    "bombay": "mumbai",
    "new delhi": "delhi",
    "peking": "beijing",
    "the gta": "toronto",
    "toronto, canada": "toronto",
    "toronto, on": "toronto",
}


def normalize(name: str) -> str:
    """Lowercase, collapse whitespace, and drop a trailing country/state suffix."""
    cleaned = " ".join(name.strip().lower().split())
    if cleaned in CITIES or cleaned in ALIASES:
        return cleaned
    # "Toronto, Canada" -> "toronto" when the bare city is known.
    head = cleaned.split(",")[0].strip()
    if head in CITIES or head in ALIASES:
        return head
    return cleaned


def resolve_place(name: str) -> tuple[float, float, float]:
    """Return (lat_deg, lon_deg, elevation_m) for a known place name.

    Raises ValueError naming the alternative (explicit coordinates) so the
    caller can ask the user rather than inventing a location.
    """
    key = normalize(name)
    key = ALIASES.get(key, key)
    coords = CITIES.get(key)
    if coords is None:
        raise ValueError(
            f"Unknown place '{name}'. Pass lat/lon explicitly, or use one of "
            f"{len(CITIES)} known cities (e.g. Toronto, London, Tokyo)."
        )
    return coords


def known_places() -> list[str]:
    return sorted(CITIES)
