import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { pool } from "../lib/db";
import { postToScience } from "../lib/scienceClient";
import { idempotency } from "../middleware/idempotency";
import { asQueryable, type Queryable } from "../rag/store";
import {
  IngestError,
  askPaper,
  ingestPaper,
  type ChunkConfig,
  type ScienceChunkResponse,
} from "../rag/pipeline";
import type { ModelClient } from "../agent/loop";

const SCIENCE_URL = process.env.SCIENCE_URL;
if (!SCIENCE_URL) {
  throw new Error(
    "SCIENCE_URL is required. Set it in api/.env for local dev and in the production environment settings.",
  );
}
const SCIENCE_BASE: string = SCIENCE_URL.replace(/\/+$/, "");

/** Matches the science service's own cap (15 MB), before base64 expansion. */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** 15 MB of bytes is ~20 MB of base64. */
const MAX_BASE64_CHARS = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 1024;

const UploadBody = z.object({
  filename: z.string().trim().min(1).max(255),
  pdf_base64: z.string().min(1).max(MAX_BASE64_CHARS),
  title: z.string().trim().min(1).max(500).optional(),
  // Exposed so Week 6's experiment can vary chunk size without a code change.
  chunk: z
    .object({
      target_chars: z.number().int().min(200).max(8000).optional(),
      max_chars: z.number().int().min(200).max(12000).optional(),
      overlap_chars: z.number().int().min(0).max(2000).optional(),
      max_pages: z.number().int().min(1).max(400).optional(),
    })
    .optional(),
});

const AskBody = z.object({
  question: z.string().trim().min(1).max(2000),
  thread_id: z.string().uuid().optional(),
  top_k: z.number().int().min(1).max(20).optional(),
  // Exposed so Week 6 can measure hybrid against vector-only retrieval.
  hybrid: z.boolean().optional(),
});

const PaperIdParam = z.string().uuid();

let sharedAi: GoogleGenAI | null = null;

function modelClient(): ModelClient {
  if (!sharedAi) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      console.warn("GEMINI_API_KEY is not set; paper answers will fail.");
    sharedAi = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }
  const client = sharedAi;
  return { generate: (request) => client.models.generateContent(request) };
}

async function chunkPdfViaScience(
  paperId: string,
  pdfBase64: string,
  config: ChunkConfig,
): Promise<ScienceChunkResponse> {
  const outcome = await postToScience(SCIENCE_BASE, "/documents/chunk", {
    paper_id: paperId,
    pdf_base64: pdfBase64,
    ...config,
  });
  if (outcome.kind === "network") {
    throw new IngestError("The document service is unavailable.", 502);
  }
  if (outcome.status === 422 || outcome.status === 413) {
    const detail =
      outcome.body &&
      typeof outcome.body === "object" &&
      "detail" in outcome.body
        ? String((outcome.body as { detail: unknown }).detail)
        : "The PDF could not be processed.";
    throw new IngestError(detail, outcome.status === 413 ? 413 : 422);
  }
  if (outcome.status !== 200) {
    throw new IngestError(
      `The document service responded ${outcome.status}.`,
      502,
    );
  }
  return outcome.body as ScienceChunkResponse;
}

/**
 * Optional Supabase Storage upload.
 *
 * DECISION (ADR-006): storage is best-effort and off unless configured.
 * Chunking reads the uploaded bytes directly, so the pipeline never depends on
 * the upload; what a failed upload costs is the ability to re-download the
 * original PDF later, not the ability to answer questions about it. Configure
 * SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET to enable it.
 */
function storagePutter():
  ((path: string, bytes: Buffer) => Promise<void>) | undefined {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  const baseUrl = process.env.SUPABASE_URL;
  if (!serviceKey || !bucket || !baseUrl) return undefined;

  return async (path: string, bytes: Buffer) => {
    const url = `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${encodeURI(path)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      // Never echo the URL: it is fine, but the Authorization header is not, and
      // keeping the pattern consistent avoids a future leak.
      throw new Error(`storage upload responded ${response.status}`);
    }
  };
}

function db(): Queryable {
  return asQueryable(pool);
}

function sendError(res: Response, err: unknown, context: string): void {
  if (err instanceof IngestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(`${context} failed:`, err);
  res.status(500).json({ error: "The request could not be completed." });
}

const router: Router = Router();

/** POST /api/papers — upload and ingest a PDF. */
router.post(
  "/",
  idempotency("POST /api/papers"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UploadBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = parsed.data.pdf_base64.includes(",")
      ? parsed.data.pdf_base64.slice(parsed.data.pdf_base64.indexOf(",") + 1)
      : parsed.data.pdf_base64;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(payload, "base64");
    } catch {
      res.status(400).json({ error: "pdf_base64 is not valid base64." });
      return;
    }
    if (bytes.length === 0) {
      res.status(400).json({ error: "pdf_base64 decoded to zero bytes." });
      return;
    }
    if (bytes.length > MAX_PDF_BYTES) {
      res
        .status(413)
        .json({ error: `PDF is larger than ${MAX_PDF_BYTES} bytes.` });
      return;
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      res.status(422).json({ error: "That file is not a PDF." });
      return;
    }

    try {
      const result = await ingestPaper(
        { db: db(), chunkPdf: chunkPdfViaScience, storePdf: storagePutter() },
        {
          userId,
          filename: parsed.data.filename,
          bytes,
          title: parsed.data.title,
          chunkConfig: parsed.data.chunk ?? {},
        },
      );
      res.status(result.deduplicated ? 200 : 201).json(result);
    } catch (err) {
      sendError(res, err, "POST /api/papers");
    }
  },
);

/** GET /api/papers — the caller's papers, newest first. */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await db().query(
      `SELECT id, title, status, page_count, chunk_count, warnings, embedding_model,
              chunk_config, error, created_at
         FROM public.papers
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.auth?.userId],
    );
    res.json({ papers: rows });
  } catch (err) {
    sendError(res, err, "GET /api/papers");
  }
});

/** GET /api/papers/:id — one paper with its section outline. */
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = PaperIdParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid paper id." });
    return;
  }
  try {
    const store = db();
    const { rows } = await store.query(
      `SELECT id, title, status, page_count, chunk_count, warnings, embedding_model,
              chunk_config, error, created_at
         FROM public.papers WHERE id = $1 AND user_id = $2`,
      [id.data, req.auth?.userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Paper not found." });
      return;
    }
    const sections = await store.query(
      `SELECT DISTINCT section_index AS index, section_path AS path
         FROM public.paper_chunks WHERE paper_id = $1 ORDER BY section_index`,
      [id.data],
    );
    res.json({ paper: rows[0], sections: sections.rows });
  } catch (err) {
    sendError(res, err, "GET /api/papers/:id");
  }
});

/** POST /api/papers/:id/ask — a cited answer, or a refusal. */
router.post(
  "/:id/ask",
  idempotency("POST /api/papers/:id/ask"),
  async (req: Request, res: Response): Promise<void> => {
    const id = PaperIdParam.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid paper id." });
      return;
    }
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await askPaper(
        { db: db(), model: modelClient() },
        {
          userId,
          paperId: id.data,
          question: parsed.data.question,
          threadId: parsed.data.thread_id,
          retrieval: { topK: parsed.data.top_k, hybrid: parsed.data.hybrid },
        },
      );
      res.json(result);
    } catch (err) {
      sendError(res, err, "POST /api/papers/:id/ask");
    }
  },
);

/** GET /api/papers/:id/thread — the conversation so far. */
router.get(
  "/:id/thread",
  async (req: Request, res: Response): Promise<void> => {
    const id = PaperIdParam.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid paper id." });
      return;
    }
    try {
      const store = db();
      const thread = await store.query<{ id: string }>(
        `SELECT id FROM public.paper_threads
        WHERE paper_id = $1 AND user_id = $2
        ORDER BY created_at DESC LIMIT 1`,
        [id.data, req.auth?.userId],
      );
      if (thread.rows.length === 0) {
        res.json({ thread_id: null, messages: [] });
        return;
      }
      const messages = await store.query(
        `SELECT role, content, citations, outcome, created_at
         FROM public.paper_messages WHERE thread_id = $1 ORDER BY created_at, id`,
        [thread.rows[0].id],
      );
      res.json({ thread_id: thread.rows[0].id, messages: messages.rows });
    } catch (err) {
      sendError(res, err, "GET /api/papers/:id/thread");
    }
  },
);

/** DELETE /api/papers/:id — remove a paper and its chunks. */
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = PaperIdParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid paper id." });
    return;
  }
  try {
    const { rows } = await db().query<{ id: string }>(
      "DELETE FROM public.papers WHERE id = $1 AND user_id = $2 RETURNING id",
      [id.data, req.auth?.userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Paper not found." });
      return;
    }
    res.status(204).end();
  } catch (err) {
    sendError(res, err, "DELETE /api/papers/:id");
  }
});

export default router;
