import crypto from "crypto";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";

const LOCK_PREFIX = "idempotency:lock:";
const RESPONSE_PREFIX = "idempotency:response:";
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
 * If client sends kaey with different vody -> reject.
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
export async function withIdempotency<T>(
  key: string,
  payload: unknown,
  fn: () => Promise<{ result: T; response: IdempotencyResponse }>,
): Promise<T> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const responseKey = `${RESPONSE_PREFIX}${key}`;
  const payloadHash = hashPayload(payload);

  // check if already exist

  const cached = await redis.get(responseKey);
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

  const lockAcquired = await redis.set(
    lockKey,
    payloadHash,
    "EX",
    LOCK_TTL_SECOND,
    "NX",
  );

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
    await redis.setex(
      responseKey,
      RESPONSE_TTL_SECOND,
      JSON.stringify(cacheData),
    );

    succeeded = true;
    return result;
  } finally {
    if (!succeeded) {
      await redis.del(lockKey);
    }
  }
}
