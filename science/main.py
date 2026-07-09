from fastapi import FastAPI

app = FastAPI(title="AstroAI Science Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "science"}
