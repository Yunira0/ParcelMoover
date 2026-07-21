import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { resolveOwnVendorId, type ScopeActor } from "./vendor-scope.service";

const ACTIVE_NOTICES_KEY = "vendor_notices:active";
// Long TTL as a safety net only - every write path below actively
// invalidates this key, so correctness doesn't depend on the TTL. This is
// the standard cache-aside pattern: cache reads, invalidate on write, keep a
// generous fallback expiry in case an invalidation is ever missed.
const ACTIVE_NOTICES_TTL = 3600; // 1 hour
const DISMISSED_PREFIX = "vendor_notices:dismissed:";
const DISMISSED_TTL = 3600; // 1 hour

export interface VendorNoticeDTO {
  id: string;
  title: string;
  imageUrl: string;
  isActive: boolean;
  isDismissable: boolean;
  target: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorNoticeWithDismissed extends VendorNoticeDTO {
  dismissed: boolean;
}

function mapNotice(row: {
  id: string;
  title: string;
  image_url: string;
  is_active: boolean;
  is_dismissable: boolean;
  target: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}): VendorNoticeDTO {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    isActive: row.is_active,
    isDismissable: row.is_dismissable,
    target: row.target,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function invalidateActiveCache(): Promise<void> {
  try {
    await redis.del(ACTIVE_NOTICES_KEY);
  } catch (error) {
    console.error("[Redis] Failed to invalidate vendor notices cache:", error);
  }
}

async function invalidateDismissedCache(vendorId: string): Promise<void> {
  try {
    await redis.del(`${DISMISSED_PREFIX}${vendorId}`);
  } catch (error) {
    console.error("[Redis] Failed to invalidate vendor dismissed cache:", error);
  }
}

// Get active notices cached in Redis. Falls back to DB on Redis failure -
// a cache outage must never take the popup (or the page it's on) down.
async function getCachedActiveNotices(): Promise<VendorNoticeDTO[]> {
  try {
    const cached = await redis.get(ACTIVE_NOTICES_KEY);
    if (cached) {
      return JSON.parse(cached) as VendorNoticeDTO[];
    }
  } catch (error) {
    console.error("[Redis] Failed to read active vendor notices:", error);
  }

  const rows = await prisma.vendor_notices.findMany({
    where: { is_active: true },
    orderBy: { created_at: "desc" },
  });

  const notices = rows.map(mapNotice);

  try {
    await redis.setex(ACTIVE_NOTICES_KEY, ACTIVE_NOTICES_TTL, JSON.stringify(notices));
  } catch (error) {
    console.error("[Redis] Failed to cache active vendor notices:", error);
  }

  return notices;
}

// Get dismissed notice IDs for a vendor, cached in Redis.
async function getDismissedIds(vendorId: string): Promise<Set<string>> {
  const cacheKey = `${DISMISSED_PREFIX}${vendorId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return new Set(JSON.parse(cached) as string[]);
    }
  } catch (error) {
    console.error("[Redis] Failed to read dismissed vendor notices:", error);
  }

  const rows = await prisma.vendor_notice_dismissals.findMany({
    where: { vendor_id: vendorId },
    select: { notice_id: true },
  });

  const ids = rows.map((r) => r.notice_id);

  try {
    await redis.setex(cacheKey, DISMISSED_TTL, JSON.stringify(ids));
  } catch (error) {
    console.error("[Redis] Failed to cache dismissed vendor notices:", error);
  }

  return new Set(ids);
}

// --- Vendor-facing ---

// Called every time a vendor opens the portal (see VendorNoticePopup). Both
// lookups are Redis-cached, so this is a couple of GETs on the hot path, not
// a DB round trip - the popup check adds no meaningful latency to page load.
export async function getActiveNoticesForVendor(
  actor: ScopeActor,
): Promise<VendorNoticeWithDismissed[]> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) {
    throw new AppError(403, "Vendor profile not found");
  }

  const [allActive, dismissedIds] = await Promise.all([
    getCachedActiveNotices(),
    getDismissedIds(vendorId),
  ]);

  // Filter: show all "all" notices + "specific" notices targeting this vendor
  const targetedNotices = await prisma.vendor_notice_targets.findMany({
    where: { vendor_id: vendorId },
    select: { notice_id: true },
  });
  const targetedIds = new Set(targetedNotices.map((t) => t.notice_id));

  return allActive
    .filter((n) => n.target === "all" || targetedIds.has(n.id))
    .map((n) => ({ ...n, dismissed: dismissedIds.has(n.id) }));
}

export async function dismissNotice(
  noticeId: string,
  actor: ScopeActor,
): Promise<void> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) {
    throw new AppError(403, "Vendor profile not found");
  }
  const notice = await prisma.vendor_notices.findUnique({
    where: { id: noticeId },
    select: { id: true, is_dismissable: true },
  });

  if (!notice) {
    throw new AppError(404, "Notice not found");
  }

  if (!notice.is_dismissable) {
    throw new AppError(400, "This notice cannot be dismissed");
  }

  // Idempotent: ignore if already dismissed
  await prisma.vendor_notice_dismissals.upsert({
    where: {
      notice_id_vendor_id: { notice_id: noticeId, vendor_id: vendorId },
    },
    create: { notice_id: noticeId, vendor_id: vendorId },
    update: {}, // no-op, just ensures row exists
  });

  await invalidateDismissedCache(vendorId);
}

// --- Admin-facing ---

export async function listNotices(): Promise<VendorNoticeDTO[]> {
  const rows = await prisma.vendor_notices.findMany({
    orderBy: { created_at: "desc" },
  });
  return rows.map(mapNotice);
}

export async function getNoticeById(id: string) {
  const row = await prisma.vendor_notices.findUnique({
    where: { id },
  });

  if (!row) {
    throw new AppError(404, "Notice not found");
  }

  const targets = await prisma.vendor_notice_targets.findMany({
    where: { notice_id: id },
    select: { vendor_id: true },
  });

  return {
    ...mapNotice(row),
    targetVendorIds: targets.map((t) => t.vendor_id),
  };
}

export async function createNotice(
  data: {
    title: string;
    imageUrl: string;
    isDismissable?: boolean;
    target?: string;
    targetVendorIds?: string[];
  },
  createdBy: string,
): Promise<VendorNoticeDTO> {
  const notice = await prisma.vendor_notices.create({
    data: {
      title: data.title,
      image_url: data.imageUrl,
      is_dismissable: data.isDismissable ?? true,
      target: data.target ?? "all",
      created_by: createdBy,
    },
  });

  if (data.target === "specific" && data.targetVendorIds?.length) {
    await prisma.vendor_notice_targets.createMany({
      data: data.targetVendorIds.map((vid) => ({
        notice_id: notice.id,
        vendor_id: vid,
      })),
      skipDuplicates: true,
    });
  }

  await invalidateActiveCache();
  return mapNotice(notice);
}

export async function updateNotice(
  id: string,
  data: {
    title?: string;
    imageUrl?: string;
    isActive?: boolean;
    isDismissable?: boolean;
    target?: string;
    targetVendorIds?: string[];
  },
): Promise<VendorNoticeDTO> {
  const existing = await prisma.vendor_notices.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Notice not found");
  }

  const notice = await prisma.vendor_notices.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.imageUrl !== undefined && { image_url: data.imageUrl }),
      ...(data.isActive !== undefined && { is_active: data.isActive }),
      ...(data.isDismissable !== undefined && { is_dismissable: data.isDismissable }),
      ...(data.target !== undefined && { target: data.target }),
    },
  });

  // Update specific targets if provided
  if (data.target !== undefined || data.targetVendorIds !== undefined) {
    const target = data.target ?? notice.target;
    await prisma.vendor_notice_targets.deleteMany({ where: { notice_id: id } });
    if (target === "specific" && data.targetVendorIds?.length) {
      await prisma.vendor_notice_targets.createMany({
        data: data.targetVendorIds.map((vid) => ({
          notice_id: id,
          vendor_id: vid,
        })),
        skipDuplicates: true,
      });
    }
  }

  await invalidateActiveCache();

  // If deactivated, also clear dismissed caches for all vendors (so re-activating works fresh)
  if (data.isActive === false) {
    await scanAndDelete(`${DISMISSED_PREFIX}*`);
  }

  return mapNotice(notice);
}

export async function deleteNotice(id: string): Promise<void> {
  const existing = await prisma.vendor_notices.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Notice not found");
  }

  // Soft-delete: set inactive
  await prisma.vendor_notices.update({
    where: { id },
    data: { is_active: false },
  });

  await invalidateActiveCache();
  await scanAndDelete(`${DISMISSED_PREFIX}*`);
}

export async function hardDeleteNotice(id: string): Promise<void> {
  const existing = await prisma.vendor_notices.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Notice not found");
  }

  await prisma.vendor_notice_dismissals.deleteMany({ where: { notice_id: id } });
  await prisma.vendor_notice_targets.deleteMany({ where: { notice_id: id } });
  await prisma.vendor_notices.delete({ where: { id } });

  await invalidateActiveCache();
  await scanAndDelete(`${DISMISSED_PREFIX}*`);
}
