import { scanAndDelete } from "../../lib/redis";

export const DASHBOARD_SUMMARY_CACHE_PREFIX = "dashboard:summary:";
export const DASHBOARD_SUMMARY_TTL_SECONDS = 30;
export const ORDERS_LIST_CACHE_PREFIX = "orders:list:";
export const ORDERS_LIST_TTL_SECONDS = 20;

export function dashboardSummaryCacheKey(vendorId?: string, riderId?: string, trendDays: 7 | 30 = 7) {
  return `${DASHBOARD_SUMMARY_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}:${trendDays}d`;
}

// Sales accounts sharing the same vendor set may safely share a cached result.
export function salesDashboardSummaryCacheKey(vendorIds: string[], trendDays: 7 | 30 = 7) {
  return `${DASHBOARD_SUMMARY_CACHE_PREFIX}sales:${vendorIds.slice().sort().join(",")}:${trendDays}d`;
}

// Coalesce concurrent cache misses so a dashboard burst runs one aggregation.
const inFlightComputations = new Map<string, Promise<unknown>>();

export async function dedupeInFlight<T>(key: string | null, compute: () => Promise<T>): Promise<T> {
  if (!key) return compute();

  const existing = inFlightComputations.get(key);
  if (existing) return existing as Promise<T>;

  const promise = compute().finally(() => {
    inFlightComputations.delete(key);
  });
  inFlightComputations.set(key, promise);
  return promise;
}

// Only the default, unfiltered list is cached, so actor scope forms the key.
export function ordersListCacheKey(vendorId?: string, riderId?: string) {
  return `${ORDERS_LIST_CACHE_PREFIX}${vendorId ?? "none"}:${riderId ?? "none"}`;
}

// Cache invalidation is best-effort; a Redis outage must not block a write.
export async function invalidateOrderCaches() {
  try {
    await Promise.all([
      scanAndDelete(`${DASHBOARD_SUMMARY_CACHE_PREFIX}*`),
      scanAndDelete(`${ORDERS_LIST_CACHE_PREFIX}*`),
    ]);
  } catch (error) {
    console.error("[Redis] Failed to invalidate order caches:", error);
  }
}
