import { createHash } from "node:crypto";
import redis from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import type { CreateOrderInput } from "../../types/order.type";

const WINDOW_SECONDS = 60 * 60;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .filter(([key, val]) => val !== undefined && key !== "confirmDuplicate")
      .map(([key, val]) => [key, canonical(val)]));
  }
  return value;
}

export function bulkBatchKey(scope: string, rows: CreateOrderInput[]) {
  const fingerprint = createHash("sha256").update(rows.map(row => JSON.stringify(canonical(row))).sort().join("\n")).digest("hex");
  return `bulk-import:batch:${scope}:${fingerprint}`;
}

export async function assertNotDuplicateBatch(key: string, confirmed: boolean | undefined) {
  if (confirmed) return;
  let cached: string | null;
  try { cached = await redis.get(key); } catch { return; }
  if (!cached) return;
  let previous: { created: number; createdAt: number };
  try { previous = JSON.parse(cached); } catch { return; }
  if (!Number.isInteger(previous.created) || previous.created < 1 || !Number.isFinite(previous.createdAt)) return;
  throw new AppError(409, `${previous.created} order(s) from this identical batch were imported recently. Confirm the duplicate batch to import again.`, "DUPLICATE_BATCH");
}

export async function rememberBulkBatch(key: string, created: number) {
  if (!created) return;
  try { await redis.setex(key, WINDOW_SECONDS, JSON.stringify({ created, createdAt: Date.now() })); } catch { /* An optional warning must not turn a completed import into a failure. */ }
}
