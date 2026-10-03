"""Route-level tests for the science service.

Network is never touched: the ISS routes' TLE fetch is monkeypatched to the
fixture TLE, so these tests assert HTTP contract (status codes, shapes,
validation) rather than re-testing the propagator.
"""
import pytest
from fastapi.testclient import TestClient

import iss
import main
from test_iss import FIXTURE_L1, FIXTURE_L2

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def offline_tle(monkeypatch):
    """Serve the fixture TLE for every request; fail loudly if anything fetches."""
    tle = iss.parse_tle(f"ISS (ZARYA)\n{FIXTURE_L1}\n{FIXTURE_L2}")
    monkeypatch.setattr(iss, "fetch_tle", lambda force=False: tle)

    def _no_network(*_a, **_k):
        raise AssertionError("test attempted a network call")

    monkeypatch.setattr(iss.urllib.request, "urlopen", _no_network)
    return tle


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------- /calculate ----------

def test_period_route_returns_formula_and_value():
    r = client.post("/calculate/period", json={"altitude_km": 400})
    assert r.status_code == 200
    body = r.json()
    assert body["period_s"] == pytest.approx(5554, rel=0.005)
    assert body["formula"] == "T = 2π·√(a³/μ)"


def test_period_route_rejects_negative_altitude():
    r = client.post("/calculate/period", json={"altitude_km": -100})
    assert r.status_code == 422


def test_hohmann_route_adds_total_dv():
    r = client.post("/calculate/hohmann", json={"alt1_km": 400, "alt2_km": 35786})
    assert r.status_code == 200
    body = r.json()
    assert body["dv_total_kms"] == pytest.approx(3.85, rel=0.01)


def test_calculate_route_rejects_missing_field():
    r = client.post("/calculate/period", json={})
    assert r.status_code == 422


# ---------- /iss ----------

def test_iss_position_route():
    r = client.get("/iss/position")
    assert r.status_code == 200
    body = r.json()
    assert body["norad_id"] == 25544
    assert -90 <= body["latitude_deg"] <= 90
    assert 380 < body["altitude_km"] < 460
    assert body["tle_epoch"] == "26273.46514106"


def test_iss_passes_by_place():
    r = client.post("/iss/passes", json={"place": "Toronto", "days": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["site"]["resolved_from"] == "Toronto"
    assert body["site"]["latitude_deg"] == pytest.approx(43.65, abs=0.05)
    assert body["pass_count"] >= 1
    assert "SGP4" in body["method"]


def test_iss_passes_by_coordinates():
    r = client.post("/iss/passes", json={"lat_deg": 43.65, "lon_deg": -79.38, "days": 1})
    assert r.status_code == 200
    assert "resolved_from" not in r.json()["site"]


def test_iss_passes_unknown_place_is_422_with_guidance():
    r = client.post("/iss/passes", json={"place": "Atlantis"})
    assert r.status_code == 422
    assert "lat/lon" in r.json()["detail"]


def test_iss_passes_requires_a_location():
    r = client.post("/iss/passes", json={"days": 1})
    assert r.status_code == 422
    assert "place" in r.json()["detail"]


@pytest.mark.parametrize(
    "body",
    [
        {"lat_deg": 100, "lon_deg": 0},
        {"lat_deg": 0, "lon_deg": 200},
        {"place": "Toronto", "days": 50},
        {"place": "Toronto", "min_elevation_deg": 95},
        {"place": "Toronto", "max_passes": 0},
    ],
)
def test_iss_passes_rejects_out_of_range(body):
    assert client.post("/iss/passes", json=body).status_code == 422


def test_iss_position_returns_503_when_no_tle(monkeypatch):
    def _unavailable(force=False):
        raise iss.TleUnavailable("Could not fetch ISS TLE: offline")

    monkeypatch.setattr(iss, "fetch_tle", _unavailable)
    r = client.get("/iss/position")
    assert r.status_code == 503
    assert "TLE" in r.json()["detail"]


def test_iss_places_route_lists_gazetteer():
    r = client.get("/iss/places")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == len(body["places"])
    assert "toronto" in body["places"]


# ---------- /documents/chunk ----------

def _tiny_pdf() -> bytes:
    """A two-page PDF with one numbered section, built in-process."""
    from test_pdf import body, build_pdf, heading

    return build_pdf([
        [heading("1. Introduction"), body("The satellite was placed into a low orbit."),
         body("Its altitude decayed faster than the mission design predicted.")],
        [heading("2. Methods"), body("We propagated the two-line elements with SGP4."),
         body("Atmospheric density came from the NRLMSISE-00 model.")],
    ])


def test_documents_chunk_returns_chunks_with_citation_metadata():
    import base64

    payload = {"paper_id": "test-paper", "pdf_base64": base64.b64encode(_tiny_pdf()).decode()}
    r = client.post("/documents/chunk", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["paper_id"] == "test-paper"
    assert data["page_count"] == 2
    assert data["chunks"]
    first = data["chunks"][0]
    for key in ("content", "page", "page_end", "section", "section_path", "chunk_index"):
        assert key in first
    assert {c["section"] for c in data["chunks"]} >= {"1. Introduction", "2. Methods"}
    assert data["stats"]["count"] == len(data["chunks"])
    assert any(s["path"] == "2. Methods" for s in data["sections"])


def test_documents_chunk_accepts_a_data_url_prefix():
    import base64

    encoded = base64.b64encode(_tiny_pdf()).decode()
    r = client.post(
        "/documents/chunk",
        json={"paper_id": "p", "pdf_base64": f"data:application/pdf;base64,{encoded}"},
    )
    assert r.status_code == 200


def test_documents_chunk_rejects_invalid_base64():
    r = client.post("/documents/chunk", json={"paper_id": "p", "pdf_base64": "not base64 !!!"})
    assert r.status_code == 422
    assert "base64" in r.json()["detail"]


def test_documents_chunk_rejects_a_non_pdf():
    import base64

    r = client.post(
        "/documents/chunk",
        json={"paper_id": "p", "pdf_base64": base64.b64encode(b"hello world").decode()},
    )
    assert r.status_code == 422


def test_documents_chunk_rejects_an_oversized_pdf():
    import base64

    oversized = base64.b64encode(b"%PDF-1.7\n" + b"0" * (16 * 1024 * 1024)).decode()
    r = client.post("/documents/chunk", json={"paper_id": "p", "pdf_base64": oversized})
    assert r.status_code == 413


def test_documents_chunk_requires_a_paper_id():
    import base64

    r = client.post(
        "/documents/chunk",
        json={"pdf_base64": base64.b64encode(_tiny_pdf()).decode()},
    )
    assert r.status_code == 422


def test_documents_chunk_honours_size_overrides():
    import base64

    encoded = base64.b64encode(_tiny_pdf()).decode()
    big = client.post("/documents/chunk", json={"paper_id": "p", "pdf_base64": encoded,
                                                "target_chars": 4000, "max_chars": 5000}).json()
    small = client.post("/documents/chunk", json={"paper_id": "p", "pdf_base64": encoded,
                                                  "target_chars": 220, "max_chars": 300,
                                                  "overlap_chars": 0}).json()
    assert small["stats"]["count"] >= big["stats"]["count"]
    assert small["stats"]["chars_max"] <= 300


def test_documents_chunk_rejects_a_scanned_pdf_with_no_text():
    import base64

    import pymupdf

    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    r = client.post(
        "/documents/chunk",
        json={"paper_id": "p", "pdf_base64": base64.b64encode(data).decode()},
    )
    assert r.status_code == 422
    assert "scan" in r.json()["detail"].lower()
