import crypto from "crypto";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";

const LOCK_PREFIX = "idempotency:lock:";
const RESPONSE_PREFIX = "idempotency:response:";
// Default lock window. Callers whose handler can run longer than this (e.g.
// bulk operations processing many rows sequentially) should pass a larger
// options.lockTtlSeconds, or a slow request's lock can expire mid-flight and
// let a client's retry re-run the same work concurrently.
const LOCK_TTL_SECOND = 60;
const RESPONSE_TTL_SECOND = 24 * 60 * 60;

interface IdempotencyResponse {
  statusCode: number;
  body: unknown;
  resourceID: string;
}

interface CachedResponse extends IdempotencyResponse {
  _payloadHash: string;
}

/**
 * Hash the request payload to detect tampering
 * If client sends key with different body -> reject.
 */
function hashPayload(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Execute a function with idempotency protection.
 *
 * FLOW:
 * 1. Check if completed response exists → return cached result
 * 2. Verify payload hash matches (prevent key reuse with different body)
 * 3. Try to acquire lock (NX = only if not exists)
 * 4. If lock exists → request in progress, return 409
 * 5. Execute function
 * 6. On success: cache response, let lock expire via TTL (no DEL)
 * 7. On failure: release lock so retry can proceed immediately
 */
// result and response.body must be the *same* value (or at least the same
// shape) - withIdempotency returns `result` on a fresh call and `response.body`
// on a replayed one, so if callers pass different shapes for each, a retried
// request gets back something different from what the original call returned.
export async function withIdempotency<T>(
  key: string,
  payload: unknown,
  fn: () => Promise<{ result: T; response: IdempotencyResponse }>,
  options?: { lockTtlSeconds?: number },
): Promise<T> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const responseKey = `${RESPONSE_PREFIX}${key}`;
  const payloadHash = hashPayload(payload);
  const lockTtlSeconds = options?.lockTtlSeconds ?? LOCK_TTL_SECOND;

  // check if already exist
  // Redis is optional everywhere else in the app (caches fall back to Postgres
  // on failure) - idempotency should degrade the same way instead of hard-failing
  // order create/update endpoints during a Redis outage. A Redis failure here
  // means we lose duplicate-submission protection for the duration of the
  // outage, not that the request itself should fail.
  let cached: string | null = null;
  try {
    cached = await redis.get(responseKey);
  } catch (error) {
    console.error("[Idempotency] Redis read failed, proceeding without dedup check:", error);
  }

  if (cached) {
    const parsed: CachedResponse = JSON.parse(cached);

    // security -> cerify paylload hasn't changed
    if (parsed._payloadHash !== payloadHash) {
      throw new AppError(422, "Idempotency key reused with different payload");
    }

    return parsed.body as T;
  }

  //step 2 acquire distributed lock
  // NX -> only set if not exists
  // EX -> Expire after LOCK_TTL_SECONDS auto release if server crashes

  let lockAcquired: string | null = "SKIPPED";
  try {
    lockAcquired = await redis.set(
      lockKey,
      payloadHash,
      "EX",
      lockTtlSeconds,
      "NX",
    );
  } catch (error) {
    console.error("[Idempotency] Redis lock acquisition failed, proceeding without lock:", error);
  }

  if (!lockAcquired) {
    throw new AppError(
      409,
      "Request is being processed, Retry after a few second",
    );
  }

  let succeeded = false;
  try {
    //step 3 execute the actual business logic
    const { result, response } = await fn();

    //step 4 cache the successful response
    const cacheData: CachedResponse = {
      ...response,
      _payloadHash: payloadHash,
    };

    // store response with 24h TTL, release lock immediately
    try {
      await redis.setex(
        responseKey,
        RESPONSE_TTL_SECOND,
        JSON.stringify(cacheData),
      );
    } catch (error) {
      console.error("[Idempotency] Redis write failed, result won't be replayable on retry:", error);
    }

    succeeded = true;
    return result;
  } finally {
    if (!succeeded) {
      try {
        await redis.del(lockKey);
      } catch (error) {
        console.error("[Idempotency] Failed to release lock after error:", error);
      }
    }
  }
}
