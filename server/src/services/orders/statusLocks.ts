import redis from "../../lib/redis";
import { AppError } from "../../utils/AppError";

const PARCEL_STATUS_LOCK_PREFIX = "parcel-status-lock:";
const PARCEL_STATUS_LOCK_TTL_SECONDS = 15;

// Lock each parcel before validating a status transition so concurrent requests
// cannot both act on the same previous state. As elsewhere in the app, Redis
// failures degrade to an unlocked update rather than blocking the operation.
export async function withParcelStatusLocks<T>(parcelIds: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueIds = Array.from(new Set(parcelIds));
  const acquiredKeys: string[] = [];
  try {
    let results: Array<[Error | null, unknown]> | null = null;
    try {
      const pipeline = redis.pipeline();
      for (const id of uniqueIds) {
        pipeline.set(`${PARCEL_STATUS_LOCK_PREFIX}${id}`, "1", "EX", PARCEL_STATUS_LOCK_TTL_SECONDS, "NX");
      }
      results = await pipeline.exec();
    } catch (error) {
      console.error("[Redis] Parcel status lock acquisition failed, proceeding without lock:", error);
    }
    if (results) {
      let contended = false;
      uniqueIds.forEach((id, i) => {
        const [err, value] = results![i] ?? [null, null];
        if (err) return;
        if (value) {
          acquiredKeys.push(`${PARCEL_STATUS_LOCK_PREFIX}${id}`);
        } else {
          contended = true;
        }
      });
      if (contended) {
        throw new AppError(409, "This order is being updated by another request - please retry.");
      }
    }
    return await fn();
  } finally {
    if (acquiredKeys.length) {
      try {
        await redis.del(...acquiredKeys);
      } catch (error) {
        console.error("[Redis] Failed to release parcel status lock(s):", error);
      }
    }
  }
}
