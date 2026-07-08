# Astro AI

AI-powered space science learning platform (React + Express + Google Gemini).

## Prerequisites

- Node.js 22+
- A [Gemini API key](https://aistudio.google.com/apikey)

## Local development

```bash
cp .env.example .env
# Set GEMINI_API_KEY in .env

npm install
npm run dev
```

The app runs at http://localhost:3000.

## Production build

```bash
export GEMINI_API_KEY=your_key
export NODE_ENV=production

npm ci
npm run build
npm start
```

The server listens on `PORT` (default `3000`).

## Docker

```bash
docker build -t astro-ai .
docker run -p 8080:8080 -e GEMINI_API_KEY=your_key -e PORT=8080 astro-ai
```

Health check: `GET /health`

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (production) | Google Gemini API key |
| `NODE_ENV` | Yes (production) | Set to `production` for static file serving |
| `PORT` | No | HTTP port (default `3000`) |
