import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import {
  API_KEY_CACHE_TTL_SECONDS,
  apiKeyCacheKey,
  hashApiKey,
  isApiKeyShaped,
} from "../services/apiKey.service";

// Authenticates the public partner API (/api/v1) via vendor-owned API keys.
// Header-only by design: never reads cookies, so requests authenticated here
// can never ride a browser session and CSRF protection is not needed.

type ApiKeyContext = {
  id: string;
  vendorId: string;
  userId: string;
};

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyContext;
    }
  }
}

function extractKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey) return headerKey;
  return null;
}

// last_used_at is display metadata, not an audit trail - one write per key
// per minute is plenty and keeps a busy integration from hammering the table.
const lastUsedWrites = new Map<string, number>();
const LAST_USED_THROTTLE_MS = 60 * 1000;

function touchLastUsed(keyId: string): void {
  const now = Date.now();
  const last = lastUsedWrites.get(keyId);
  if (last && now - last < LAST_USED_THROTTLE_MS) return;
  lastUsedWrites.set(keyId, now);
  prisma.api_keys
    .update({ where: { id: keyId }, data: { last_used_at: new Date() } })
    .catch((error) => console.error("[ApiKey] Failed to update last_used_at:", error));
}

function unauthorized(res: Response, message: string) {
  return res.status(401).json({ success: false, message, error: { code: "UNAUTHORIZED" } });
}

export async function apiKeyAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const plaintextKey = extractKey(req);
    if (!plaintextKey || !isApiKeyShaped(plaintextKey)) {
      return unauthorized(res, "API key required. Pass it as 'Authorization: Bearer <key>'.");
    }

    const keyHash = hashApiKey(plaintextKey);
    const cacheKey = apiKeyCacheKey(keyHash);

    let context: ApiKeyContext | null = null;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) context = JSON.parse(cached);
    } catch {
      // Redis down → fall through to the database lookup.
    }

    if (!context) {
      const record = await prisma.api_keys.findUnique({
        where: { key_hash: keyHash },
        select: {
          id: true,
          revoked_at: true,
          vendors: {
            select: { id: true, user_id: true, status: true, deleted_at: true },
          },
        },
      });

      if (
        !record ||
        record.revoked_at ||
        record.vendors.deleted_at ||
        record.vendors.status !== "active" ||
        !record.vendors.user_id
      ) {
        return unauthorized(res, "Invalid or revoked API key");
      }

      context = {
        id: record.id,
        vendorId: record.vendors.id,
        userId: record.vendors.user_id,
      };

      try {
        await redis.setex(cacheKey, API_KEY_CACHE_TTL_SECONDS, JSON.stringify(context));
      } catch {
        // Cache write failure just means the next request hits the database.
      }
    }

    req.apiKey = context;
    touchLastUsed(context.id);
    next();
  } catch (error) {
    next(error);
  }
}
