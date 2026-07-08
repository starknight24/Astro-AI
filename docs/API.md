# API Reference

All endpoints are `POST`, accept/return JSON, and are served same-origin by `server.ts`. There is currently **no authentication and no rate limiting** — see [SECURITY.md](SECURITY.md) before exposing publicly.

On failure every endpoint returns `500` (or `400` where noted) with:

```json
{ "error": "<message>" }
```

---

## POST /api/chat — Concept Explainer / AI tutor

Model: `gemini-3.5-flash` (temperature 0.7).

**Request**
```json
{
  "message": "Explain Hohmann transfers",
  "history": [{ "role": "user" | "model", "text": "…" }],
  "degreeLevel": "Bachelor" | "Master" | "PhD",
  "explainSimply": false
}
```

**Response** — `{ "text": "…markdown with $LaTeX$…" }`

## POST /api/problems — Practice problem generator

Model: `gemini-3.5-flash` with JSON `responseSchema`.

**Request** — `{ "topic": "Kepler's Laws", "difficulty": "Intermediate", "count": 3 }`

**Response** — array of:
```json
{ "id": "…", "problem": "…", "hint": "…", "formulas": "…$LaTeX$…", "solution": "…" }
```

## POST /api/quiz — Quiz generator

**Request** — `{ "topic": "Orbital mechanics", "difficulty": "Medium" }`

**Response** — array of 5:
```json
{ "question": "…", "options": ["…", "…", "…", "…"], "correctAnswer": 0, "explanation": "…" }
```

## POST /api/mission — Space mission explainer

**Request** — `{ "missionName": "JWST" }`

**Response**
```json
{ "name": "…", "objectives": "…", "orbit": "…", "challenges": "…", "discoveries": "…", "links": "…" }
```

## POST /api/papers/summarize — Paper summarizer

Truncates input to the first 8,000 characters.

**Request** — `{ "paperText": "…", "title": "…" }`

**Response** — `{ "abstract": "…", "equations": "…", "methodology": "…", "findings": "…" }`

## POST /api/papers/chat — Grounded paper Q&A

Grounds on the first 10,000 characters of `paperText` (temperature 0.5).

**Request**
```json
{ "paperText": "…", "title": "…", "message": "…", "history": [{ "role": "user" | "model", "text": "…" }] }
```

**Response** — `{ "text": "…" }`

## POST /api/image/generate — Space artist (generation)

Model: `gemini-3-pro-image-preview` (default) — supports `size` of `"512px" | "1K" | "2K" | "4K"` and `aspectRatio` such as `"1:1"`, `"16:9"`.

**Request** — `{ "prompt": "…", "model": "…", "size": "1K", "aspectRatio": "1:1" }`

**Response** — `{ "imageUrl": "data:image/png;base64,…", "info": "…" }`
`400` if the model returns no image part.

## POST /api/image/edit — Space artist (editing)

Model: `gemini-3.1-flash-image-preview`. Accepts an existing image plus an instruction.

**Request** — `{ "base64Image": "data:image/png;base64,… | raw base64", "prompt": "…", "mimeType": "image/png" }`

**Response** — `{ "imageUrl": "data:image/png;base64,…", "info": "…" }`
`400` if no modified image is returned.

## POST /api/solve — Word-problem solver

**Request** — `{ "wordProblem": "A satellite orbits at 400 km…" }`

**Response**
```json
{
  "problemType": "…", "parameters": "…", "recommendedFormula": "…",
  "stepByStep": "…$LaTeX$…", "finalAnswer": "…", "similarProblem": "…"
}
```

---

## Conventions

- LaTeX in responses uses `$inline$` and `$$block$$` delimiters; the frontend renders them.
- Chat-style endpoints accept `history` as `{role, text}` pairs and map them to Gemini `user`/`model` turns.
- JSON-shaped endpoints use Gemini `responseSchema` so malformed output is rare; the server still `JSON.parse`s defensively with empty-value fallbacks.
