from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

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
