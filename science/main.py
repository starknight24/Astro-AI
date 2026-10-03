import base64
import binascii
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import chunking
import iss
import pdf
import places
from orbital import (
    escape_velocity,
    hohmann_transfer,
    orbital_period,
    orbital_velocity,
    specific_orbital_energy,
    vis_viva,
)

app = FastAPI(title="AstroAI Science Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "science"}


# ---------- Request models ----------

class AltitudeIn(BaseModel):
    altitude_km: float = Field(..., description="Altitude above Earth's surface (km).")


class VisVivaIn(BaseModel):
    altitude_km: float = Field(..., description="Altitude above Earth's surface (km).")
    semi_major_axis_km: float = Field(..., description="Semi-major axis of the orbit (km).")


class SpecificEnergyIn(BaseModel):
    semi_major_axis_km: float = Field(..., description="Semi-major axis of the orbit (km).")


class HohmannIn(BaseModel):
    alt1_km: float = Field(..., description="Initial circular orbit altitude (km).")
    alt2_km: float = Field(..., description="Target circular orbit altitude (km).")


class IssPassesIn(BaseModel):
    """Either `place` (gazetteer lookup) or an explicit lat/lon pair."""

    place: str | None = Field(None, description="City name, e.g. 'Toronto'.")
    lat_deg: float | None = Field(None, ge=-90, le=90, description="Site latitude (deg).")
    lon_deg: float | None = Field(None, ge=-180, le=180, description="Site longitude (deg).")
    elevation_m: float = Field(0.0, ge=-500, le=9000, description="Site elevation (m).")
    days: float = Field(2.0, gt=0, le=10, description="How far ahead to search (days).")
    min_elevation_deg: float = Field(
        10.0, ge=0, lt=90, description="Minimum peak elevation for a pass to count (deg)."
    )
    max_passes: int = Field(5, ge=1, le=20, description="Cap on returned passes.")


# ---------- Routes ----------

@app.post("/calculate/period")
def calculate_period(body: AltitudeIn) -> dict:
    try:
        return orbital_period(body.altitude_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/calculate/velocity")
def calculate_velocity(body: AltitudeIn) -> dict:
    try:
        return orbital_velocity(body.altitude_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/calculate/escape-velocity")
def calculate_escape_velocity(body: AltitudeIn) -> dict:
    try:
        return escape_velocity(body.altitude_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/calculate/vis-viva")
def calculate_vis_viva(body: VisVivaIn) -> dict:
    try:
        return vis_viva(body.altitude_km, body.semi_major_axis_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/calculate/energy")
def calculate_energy(body: SpecificEnergyIn) -> dict:
    try:
        return specific_orbital_energy(body.semi_major_axis_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/calculate/hohmann")
def calculate_hohmann(body: HohmannIn) -> dict:
    try:
        result = hohmann_transfer(body.alt1_km, body.alt2_km)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    # dv_total is derived, not part of orbital.py's contract, but useful for callers.
    result["dv_total_kms"] = abs(result["delta_v1_kms"]) + abs(result["delta_v2_kms"])
    return result


# ---------- ISS (TLE + SGP4) ----------
# DECISION (ADR-005): TLEs come from Celestrak and are propagated here with the
# reference SGP4 implementation. Open Notify's iss-now was measured 29 minutes
# (~13,000 km) stale during Week 4; N2YO needs an API key. Our chain agreed with
# an independent SGP4 service to 0.1 km.

@app.get("/iss/position")
def iss_position() -> dict:
    try:
        tle = iss.fetch_tle()
    except iss.TleUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    sat = iss.satrec_from_tle(tle)
    try:
        return iss.position_at(sat, tle, datetime.now(timezone.utc))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/iss/passes")
def iss_passes(body: IssPassesIn) -> dict:
    if body.place:
        try:
            lat, lon, elev = places.resolve_place(body.place)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        resolved_from = body.place
    elif body.lat_deg is not None and body.lon_deg is not None:
        lat, lon, elev = body.lat_deg, body.lon_deg, body.elevation_m
        resolved_from = None
    else:
        raise HTTPException(
            status_code=422,
            detail="Provide either 'place' or both 'lat_deg' and 'lon_deg'.",
        )

    try:
        tle = iss.fetch_tle()
    except iss.TleUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    sat = iss.satrec_from_tle(tle)
    try:
        result = iss.next_passes(
            sat,
            tle,
            lat_deg=lat,
            lon_deg=lon,
            elevation_m=elev,
            days=body.days,
            min_elevation_deg=body.min_elevation_deg,
            max_passes=body.max_passes,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if resolved_from:
        result["site"]["resolved_from"] = resolved_from
    return result


@app.get("/iss/places")
def iss_places() -> dict:
    """The gazetteer, so callers can tell a user what names are accepted."""
    return {"count": len(places.CITIES), "places": places.known_places()}


# ---------- Documents (PDF -> cleaned text -> section-aware chunks) ----------
# DECISION (ADR-006): the PDF arrives base64-encoded inside JSON rather than as
# multipart. It costs 33% transfer overhead, but it reuses the API's existing
# JSON client (with its timeout and retry semantics) instead of introducing a
# second transport for one route. Papers are 0.5-3 MB in practice.

MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_INGEST_PAGES = 60


class DocumentIn(BaseModel):
    paper_id: str = Field(..., min_length=1, max_length=128)
    # Base64 PDF bytes, with or without a data: URL prefix.
    pdf_base64: str = Field(..., min_length=1)
    max_pages: int = Field(MAX_INGEST_PAGES, ge=1, le=400)
    target_chars: int = Field(chunking.TARGET_CHARS, ge=200, le=8000)
    max_chars: int = Field(chunking.MAX_CHARS, ge=200, le=12000)
    overlap_chars: int = Field(chunking.OVERLAP_CHARS, ge=0, le=2000)


@app.post("/documents/chunk")
def documents_chunk(body: DocumentIn) -> dict:
    """Extract, clean and chunk a PDF. Returns chunks ready for embedding."""
    payload = body.pdf_base64.split(",", 1)[-1] if body.pdf_base64.startswith("data:") else body.pdf_base64
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"pdf_base64 is not valid base64: {exc}")
    if not raw:
        raise HTTPException(status_code=422, detail="pdf_base64 decoded to zero bytes")
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF is {len(raw)} bytes; the limit is {MAX_PDF_BYTES}",
        )

    try:
        document = pdf.extract(raw, max_pages=body.max_pages)
    except pdf.PdfExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        chunks = chunking.chunk_document(
            document,
            paper_id=body.paper_id,
            target_chars=body.target_chars,
            max_chars=body.max_chars,
            overlap_chars=body.overlap_chars,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not chunks:
        raise HTTPException(
            status_code=422,
            detail="The PDF yielded no chunks — it may contain only images or tables.",
        )

    return {
        "paper_id": body.paper_id,
        "title": document.title,
        "page_count": document.page_count,
        "pages_ingested": len(document.pages),
        "chunks": [c.to_dict() for c in chunks],
        "stats": chunking.chunk_stats(chunks),
        # Surfaced, not swallowed: the API stores these on the paper row so a
        # user can see that page 7 was a scan or that no headings were found.
        "warnings": document.warnings,
        "sections": [
            {"index": index, "path": path}
            for index, path in sorted({(c.section_index, c.section_path) for c in chunks})
        ],
    }
