import crypto from "crypto";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";
import { resolveOwnVendorId, ScopeActor } from "./vendor-scope.service";

// Vendor-owned credentials for the public /api/v1 partner surface. Only the
// SHA-256 hash is persisted; the plaintext key exists exactly once, in the
// createApiKey response.

const KEY_PREFIX = "pm_live_";
const KEY_RANDOM_BYTES = 20; // 40 hex chars
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 7; // "pm_live_a1b2c3d"
const MAX_ACTIVE_KEYS = 5;

export const API_KEY_CACHE_TTL_SECONDS = 60;

export function apiKeyCacheKey(keyHash: string): string {
  return `apikey:${keyHash}`;
}

export function hashApiKey(plaintextKey: string): string {
  return crypto.createHash("sha256").update(plaintextKey).digest("hex");
}

export function isApiKeyShaped(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

async function requireOwnVendorId(actor: ScopeActor): Promise<string> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) {
    throw new AppError(403, "Only vendor accounts can manage API keys");
  }
  return vendorId;
}

export async function createApiKey(actor: ScopeActor, name: string) {
  const vendorId = await requireOwnVendorId(actor);

  const activeCount = await prisma.api_keys.count({
    where: { vendor_id: vendorId, revoked_at: null },
  });
  if (activeCount >= MAX_ACTIVE_KEYS) {
    throw new AppError(
      409,
      `You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke one first.`,
    );
  }

  const plaintextKey = KEY_PREFIX + crypto.randomBytes(KEY_RANDOM_BYTES).toString("hex");

  const created = await prisma.api_keys.create({
    data: {
      vendor_id: vendorId,
      name,
      key_prefix: plaintextKey.slice(0, DISPLAY_PREFIX_LENGTH),
      key_hash: hashApiKey(plaintextKey),
    },
    select: { id: true, name: true, key_prefix: true, created_at: true },
  });

  return { ...created, key: plaintextKey };
}

export async function listApiKeys(actor: ScopeActor) {
  const vendorId = await requireOwnVendorId(actor);

  return prisma.api_keys.findMany({
    where: { vendor_id: vendorId },
    select: {
      id: true,
      name: true,
      key_prefix: true,
      created_at: true,
      last_used_at: true,
      revoked_at: true,
    },
    orderBy: { created_at: "desc" },
  });
}

export async function revokeApiKey(actor: ScopeActor, keyId: string) {
  const vendorId = await requireOwnVendorId(actor);

  const key = await prisma.api_keys.findFirst({
    where: { id: keyId, vendor_id: vendorId },
    select: { id: true, key_hash: true, revoked_at: true },
  });
  if (!key) {
    throw new AppError(404, "API key not found");
  }
  if (key.revoked_at) {
    throw new AppError(409, "API key is already revoked");
  }

  await prisma.api_keys.update({
    where: { id: key.id },
    data: { revoked_at: new Date() },
  });

  // Drop the auth cache entry so the revoked key dies immediately instead of
  // surviving until the cache TTL expires.
  try {
    await redis.del(apiKeyCacheKey(key.key_hash));
  } catch (error) {
    console.error("[ApiKey] Failed to evict revoked key from cache:", error);
  }
}
