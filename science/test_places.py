"""Gazetteer tests: the lookup must be forgiving on input and loud on misses."""
import pytest

import places


def test_toronto_is_known():
    lat, lon, elev = places.resolve_place("Toronto")
    assert lat == pytest.approx(43.65, abs=0.05)
    assert lon == pytest.approx(-79.38, abs=0.05)
    assert elev >= 0


@pytest.mark.parametrize(
    "name", ["Toronto", "toronto", "  TORONTO  ", "Toronto, Canada", "Toronto, ON", "the GTA"]
)
def test_toronto_spellings_all_resolve(name):
    assert places.resolve_place(name) == places.CITIES["toronto"]


@pytest.mark.parametrize(
    "alias,canonical",
    [("nyc", "new york"), ("LA", "los angeles"), ("KSC", "cape canaveral"),
     ("jpl", "pasadena"), ("Bangalore", "bengaluru")],
)
def test_aliases_resolve_to_canonical_cities(alias, canonical):
    assert places.resolve_place(alias) == places.CITIES[canonical]


@pytest.mark.parametrize("name", ["Atlantis", "Nowhere City", "", "   "])
def test_unknown_place_raises_with_actionable_message(name):
    with pytest.raises(ValueError) as exc:
        places.resolve_place(name)
    assert "lat/lon" in str(exc.value)


def test_every_city_has_plausible_coordinates():
    for name, (lat, lon, elev) in places.CITIES.items():
        assert -90 <= lat <= 90, name
        assert -180 <= lon <= 180, name
        assert -500 <= elev <= 5000, name


def test_every_alias_targets_a_real_city():
    for alias, target in places.ALIASES.items():
        assert target in places.CITIES, f"{alias} -> {target}"


def test_known_places_is_sorted_and_complete():
    assert places.known_places() == sorted(places.CITIES)
    assert len(places.known_places()) == len(places.CITIES)
