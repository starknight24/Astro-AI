import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { upsertUser } from "../lib/db";

const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required. Set it in api/.env.");
}

const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`),
);

declare module "express-serve-static-core" {
  interface Request {
    auth?: { userId: string; email: string };
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token =
    header && header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.auth = { userId, email };

    try {
      await upsertUser(userId, email);
    } catch (dbErr) {
      console.error("upsertUser failed:", dbErr);
    }

    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
