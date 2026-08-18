import { Prisma } from "../generated/prisma/client";
import { order_type, parcel_status, payment_status, settlement_status } from "../generated/prisma/enums";
import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { formatNepalDate } from "../utils/nepalTime";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { resolveOwnVendorId } from "./vendor-scope.service";
import { createNotification } from "./notification.service";
import { evaluateVendorBillingAsync } from "./billing.service";
import { syncSettlementPostings } from "./accounting/sync";

import { getActivePaymentMethodNames } from "./payment-method.service";
import {
  AttachSettlementDocumentsInput,
  CodPaymentFilter,
  CreateSettlementInput,
  CreateSettlementResult,
  PaySettlementInput,
  SettlementDocumentResult,
  SettlementPaymentInput,
  SettlementPaymentRecordResult,
  OrderCodItem,
  OrderCodListResult,
  PendingCodBill,
  PendingCodItem,
  SettlementDetailItem,
  SettlementDetailResult,
  SettlementListItem,
  SettlementsListResult,
  UnsettledOrderItem,
  UnsettledOrdersResult,
  VendorBillingProfile,
} from "../types/finance.type";

type Actor = { id: string; roles: string[] };

// Raised from 100 so the statement lists can offer a 500-row page. Reconciling
// a month of payouts means scanning them all at once; paging through 5 screens
// of 100 loses your place. The list query stays linear in rows (Prisma loads
// the relations as a handful of queries, not one per row), so 500 costs about
// 5x a page of 100 rather than blowing up.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;

// Same read-heavy, cache-worthy profile as the (already cached) dashboard
// summary - a short TTL is enough since the only write path that can change
// these is a new cod_collection row at order creation (settlements/payment
// status have no mutation endpoint yet), which explicitly invalidates below.
const FINANCE_CACHE_TTL_SECONDS = 30;

async function readFinanceCache<T>(key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key);
    return cached ? (JSON.parse(cached) as T) : null;
  } catch (error) {
    console.error("[Redis] Failed to read finance cache:", error);
    return null;
  }
}

async function writeFinanceCache(key: string, value: unknown): Promise<void> {
  try {
    await redis.setex(key, FINANCE_CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch (error) {
    console.error("[Redis] Failed to write finance cache:", error);
  }
}

// Called from order creation (fire-and-forget) whenever a vendor gets a new
// cod_collection row.
export async function invalidateVendorFinanceCache(vendorId: string): Promise<void> {
  try {
    await scanAndDelete(`finance:${vendorId}:*`);
    // The admin "all vendors" settlements list is cached under a separate
    // scope key, so it must be cleared too or a new statement won't appear.
    await scanAndDelete(`finance:all:vendor:*`);
  } catch (error) {
    console.error("[Redis] Failed to invalidate finance cache:", error);
  }
}

// Called after a rider settlement is created, mirroring invalidateVendorFinanceCache.
export async function invalidateRiderFinanceCache(riderId: string): Promise<void> {
  try {
    await scanAndDelete(`finance:rider:${riderId}:*`);
    await scanAndDelete(`finance:all:rider:*`);
  } catch (error) {
    console.error("[Redis] Failed to invalidate finance cache:", error);
  }
}

// Vendors only ever see their own finance records. Staff (admin/super_admin)
// must explicitly name a vendor - there is no "view everyone's COD" mode here,
// since this is financial data and an unscoped query would leak across vendors.
async function resolveVendor(actor: Actor, vendorIdParam?: string) {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isSales = actor.roles.includes("sales") && !isStaff;

  // Sales accounts may view finance for one of their own clients only. They must
  // name the vendor, and we verify ownership before returning it.
  if (isSales) {
    if (!vendorIdParam) {
      throw new AppError(400, "vendorId is required");
    }
    const vendor = await prisma.vendors.findFirst({
      where: { id: vendorIdParam, sales_user_id: actor.id, deleted_at: null },
    });
    if (!vendor) {
      throw new AppError(403, "Not authorized to view this client's finance records");
    }
    return vendor;
  }

  // Vendor / vendor staff: always resolved to their own vendor, never a
  // caller-supplied vendorId.
  const ownVendorId = await resolveOwnVendorId(actor);
  if (ownVendorId) {
    const vendor = await prisma.vendors.findFirst({ where: { id: ownVendorId } });
    if (!vendor) throw new AppError(403, "Vendor not found");
    return vendor;
  }

  if (!isStaff) {
    throw new AppError(403, "Not authorized to view finance records");
  }

  if (!vendorIdParam) {
    throw new AppError(400, "vendorId is required");
  }

  const vendor = await prisma.vendors.findFirst({
    where: { id: vendorIdParam, deleted_at: null },
  });
  if (!vendor) {
    throw new AppError(404, "Vendor not found");
  }
  return vendor;
}

// Riders only ever see their own settlements. Staff must explicitly name a
// rider - mirrors resolveVendor's "no unscoped view" rule for the same
// financial-data-leak reason. Sales accounts have no rider visibility at all
// (matches getUnsettledOrders below).
async function resolveRider(actor: Actor, riderIdParam?: string) {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));

  if (actor.roles.includes("rider")) {
    const rider = await prisma.riders.findFirst({
      where: { user_id: actor.id, deleted_at: null },
    });
    if (!rider) throw new AppError(403, "Rider profile not found");
    return rider;
  }

  if (!isStaff) {
    throw new AppError(403, "Not authorized to view rider settlement records");
  }

  if (!riderIdParam) {
    throw new AppError(400, "riderId is required");
  }

  const rider = await prisma.riders.findFirst({
    where: { id: riderIdParam, deleted_at: null },
  });
  if (!rider) {
    throw new AppError(404, "Rider not found");
  }
  return rider;
}

function toBillingProfile(vendor: {
  id: string;
  client_name: string;
  business_name: string | null;
  phone: string;
  email: string | null;
  address: string | null;
}): VendorBillingProfile {
  return {
    id: vendor.id,
    name: vendor.business_name || vendor.client_name,
    phone: vendor.phone,
    email: vendor.email,
    address: vendor.address,
  };
}

function formatLocation(location?: { name: string; city: string | null; district: string | null } | null) {
  if (!location) return "";
  return [location.name, location.city || location.district].filter(Boolean).join(", ");
}

export async function getPendingCodBill(actor: Actor, vendorIdParam?: string): Promise<PendingCodBill> {
  const vendor = await resolveVendor(actor, vendorIdParam);

  const cacheKey = `finance:${vendor.id}:pending-cod`;
  const cached = await readFinanceCache<PendingCodBill>(cacheKey);
  if (cached) return cached;

  const collections = await prisma.cod_collections.findMany({
    // Only orders with cash actually collected are billable (excludes
    // not-yet-delivered orders); amounts are on the collected basis so the bill
    // matches what will be settled. Orders already bundled into a vendor
    // statement are excluded - they've moved out of the pending bill and into
    // that statement, even while it awaits payment.
    where: {
      vendor_id: vendor.id,
      payment_status: payment_status.pending,
      collected_amount: { gt: 0 },
      settlement_items: { none: { settlements: { payee_type: "vendor" } } },
      // A cancelled order is void - it must never be billed, even if cash was
      // recorded as collected before the cancellation happened.
      parcels: { status: { not: parcel_status.cancelled } },
    },
    include: {
      parcels: {
        select: {
          order_number: true,
          tracking_id: true,
          delivery_charge: true,
          parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
          locations_parcels_destination_location_idTolocations: {
            select: { name: true, city: true, district: true },
          },
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const items: PendingCodItem[] = collections.map((c) => ({
    orderNumber: c.parcels.order_number,
    trackingId: c.parcels.tracking_id,
    receiverName: c.parcels.parties_parcels_receiver_idToparties.name,
    receiverPhone: c.parcels.parties_parcels_receiver_idToparties.phone,
    destination: formatLocation(c.parcels.locations_parcels_destination_location_idTolocations),
    codAmount: Number(c.collected_amount),
    deliveryCharge: Number(c.parcels.delivery_charge),
  }));

  const totalCod = items.reduce((sum, item) => sum + item.codAmount, 0);
  const deliveryCharges = items.reduce((sum, item) => sum + item.deliveryCharge, 0);

  const result: PendingCodBill = {
    vendor: toBillingProfile(vendor),
    statementDate: new Date().toISOString(),
    items,
    totals: {
      totalCod,
      deliveryCharges,
      payableAmount: totalCod - deliveryCharges,
    },
  };
  await writeFinanceCache(cacheKey, result);
  return result;
}

export async function listOrderCod(
  actor: Actor,
  vendorIdParam: string | undefined,
  status: CodPaymentFilter | undefined,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<OrderCodListResult> {
  const vendor = await resolveVendor(actor, vendorIdParam);

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * take;

  const cacheKey = `finance:${vendor.id}:order-cod:${status ?? "all"}:${safePage}:${take}`;
  const cached = await readFinanceCache<OrderCodListResult>(cacheKey);
  if (cached) return cached;

  const statusFilter =
    status === "settled" ? payment_status.paid : status === "not_settled" ? payment_status.pending : undefined;

  // An order's COD only exists once cash was actually collected, so this list
  // (and its settled/not-settled counts) is anchored on collected_amount - the
  // same honest basis the pending bill, unsettled pool and settlement payout use.
  // A cancelled order is void - it must never be billed or counted as
  // settled/unsettled, even if cash was recorded as collected before the
  // cancellation happened.
  const notCancelled: Prisma.cod_collectionsWhereInput = { parcels: { status: { not: parcel_status.cancelled } } };

  const where: Prisma.cod_collectionsWhereInput = {
    vendor_id: vendor.id,
    collected_amount: { gt: 0 },
    ...(statusFilter ? { payment_status: statusFilter } : {}),
    ...notCancelled,
  };

  const [settledCount, notSettledCount, total, collections] = await Promise.all([
    prisma.cod_collections.count({
      where: { vendor_id: vendor.id, collected_amount: { gt: 0 }, payment_status: payment_status.paid, ...notCancelled },
    }),
    prisma.cod_collections.count({
      where: { vendor_id: vendor.id, collected_amount: { gt: 0 }, payment_status: payment_status.pending, ...notCancelled },
    }),
    prisma.cod_collections.count({ where }),
    prisma.cod_collections.findMany({
      where,
      include: {
        parcels: {
          select: {
            tracking_id: true,
            delivery_charge: true,
            created_at: true,
            delivered_at: true,
            parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
  ]);

  const data: OrderCodItem[] = collections.map((c) => ({
    id: c.id,
    trackingId: c.parcels.tracking_id,
    receiverName: c.parcels.parties_parcels_receiver_idToparties.name,
    receiverPhone: c.parcels.parties_parcels_receiver_idToparties.phone,
    createdAt: c.parcels.created_at.toISOString(),
    deliveredAt: c.parcels.delivered_at ? c.parcels.delivered_at.toISOString() : null,
    status: c.payment_status === payment_status.paid ? "settled" : "not_settled",
    netPayable: Number(c.collected_amount) - Number(c.parcels.delivery_charge),
  }));

  const result: OrderCodListResult = {
    data,
    settledCount,
    notSettledCount,
    meta: {
      page: safePage,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
  await writeFinanceCache(cacheKey, result);
  return result;
}

export async function listSettlements(
  actor: Actor,
  payeeType: "rider" | "vendor",
  targetId: string | undefined,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  fromDate?: Date,
  toDate?: Date,
  status?: settlement_status,
  search?: string,
): Promise<SettlementsListResult> {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isSales = actor.roles.includes("sales") && !isStaff;

  let vendorId: string | undefined;
  let riderId: string | undefined;

  if (payeeType === "vendor") {
    if (isSales) {
      if (!targetId) throw new AppError(400, "vendorId is required");
      const owned = await prisma.vendors.findFirst({
        where: { id: targetId, sales_user_id: actor.id, deleted_at: null },
        select: { id: true },
      });
      if (!owned) throw new AppError(403, "Not authorized to view this client's records");
      vendorId = owned.id;
    } else if (isStaff) {
      // No targetId means "all vendors" - staff-only, matches the admin
      // COD Management view which lists every statement of a type at once.
      vendorId = targetId;
    } else {
      const ownVendorId = await resolveOwnVendorId(actor);
      if (!ownVendorId) throw new AppError(403, "Not authorized to view finance records");
      vendorId = ownVendorId;
    }
  } else {
    if (isSales) {
      throw new AppError(403, "Not authorized to view rider settlements");
    }
    if (isStaff) {
      riderId = targetId;
    } else {
      const rider = await prisma.riders.findFirst({
        where: { user_id: actor.id, deleted_at: null },
      });
      if (!rider) throw new AppError(403, "Rider profile not found");
      riderId = rider.id;
    }
  }

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * take;

  const scopeKey = vendorId ? vendorId : riderId ? `rider:${riderId}` : `all:${payeeType}`;
  const cacheKey = `finance:${scopeKey}:settlements:${safePage}:${take}:${fromDate?.toISOString() ?? ""}:${toDate?.toISOString() ?? ""}:${status ?? ""}:${search ?? ""}`;
  const cached = await readFinanceCache<SettlementsListResult>(cacheKey);
  if (cached) return cached;

  const where: Prisma.settlementsWhereInput = {
    payee_type: payeeType,
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(riderId ? { rider_id: riderId } : {}),
    ...(fromDate || toDate
      ? {
          settlement_date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
    ...(status ? { status } : {}),
    // Payee name filter - riders have a single name field, vendors show
    // business_name with client_name as fallback, so either can match.
    ...(search
      ? payeeType === "rider"
        ? { riders: { name: { contains: search, mode: "insensitive" } } }
        : {
            OR: [
              { vendors: { business_name: { contains: search, mode: "insensitive" } } },
              { vendors: { client_name: { contains: search, mode: "insensitive" } } },
            ],
          }
      : {}),
  };

  const [total, settlements] = await Promise.all([
    prisma.settlements.count({ where }),
    prisma.settlements.findMany({
      where,
      include: {
        settlement_items: { select: { cod_collection_id: true } },
        riders: { select: { name: true, phone: true, bank_name: true, bank_account_no: true, bank_account_holder: true } },
        vendors: {
          select: {
            client_name: true,
            business_name: true,
            phone: true,
            bank_name: true,
            bank_account_no: true,
            bank_account_holder: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
  ]);

  const data: SettlementListItem[] = settlements.map((s) => {
    const payeeName = s.riders?.name || s.vendors?.business_name || s.vendors?.client_name || "";
    const payeePhone = s.riders?.phone || s.vendors?.phone || "";
    const bankName = s.riders?.bank_name ?? s.vendors?.bank_name ?? null;
    const bankAccountNo = s.riders?.bank_account_no ?? s.vendors?.bank_account_no ?? null;
    const bankAccountHolder = s.riders?.bank_account_holder ?? s.vendors?.bank_account_holder ?? null;
    return {
      id: s.id,
      statementId: s.statement_id,
      payeeType: payeeType,
      payeeName,
      payeePhone,
      bankName,
      bankAccountNo,
      bankAccountHolder,
      transferDate: s.settlement_date ? formatNepalDate(s.settlement_date) : null,
      // Full timestamp of when the settlement was recorded, so the UI can show time.
      createdAt: s.created_at.toISOString(),
      orderCount: s.settlement_items.length,
      amount: Number(s.payable_amount ?? s.amount),
      status: s.status,
      paidAmount: Number(s.paid_amount),
      remark: s.remark,
    };
  });

  const result: SettlementsListResult = {
    data,
    meta: {
      page: safePage,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
  await writeFinanceCache(cacheKey, result);
  return result;
}

export async function getUnsettledOrders(
  actor: Actor,
  type: "rider" | "vendor",
  targetId?: string,
): Promise<UnsettledOrdersResult> {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isSales = actor.roles.includes("sales") && !isStaff;

  let riderId: string | undefined;
  let vendorId: string | undefined;

  if (type === "rider") {
    if (isSales) {
      // Sales accounts have no visibility into rider settlements.
      throw new AppError(403, "Not authorized to view rider settlements");
    }
    if (isStaff) {
      if (!targetId) throw new AppError(400, "riderId is required");
      riderId = targetId;
    } else {
      const rider = await prisma.riders.findFirst({
        where: { user_id: actor.id, deleted_at: null },
      });
      if (!rider) throw new AppError(403, "Rider profile not found");
      riderId = rider.id;
    }
  } else {
    if (isSales) {
      if (!targetId) throw new AppError(400, "vendorId is required");
      const owned = await prisma.vendors.findFirst({
        where: { id: targetId, sales_user_id: actor.id, deleted_at: null },
        select: { id: true },
      });
      if (!owned) throw new AppError(403, "Not authorized to view this client's records");
      vendorId = owned.id;
    } else if (isStaff) {
      if (!targetId) throw new AppError(400, "vendorId is required");
      vendorId = targetId;
    } else {
      const vendor = await prisma.vendors.findFirst({
        where: { user_id: actor.id, deleted_at: null, status: "active" },
      });
      if (!vendor) throw new AppError(403, "Vendor profile not found");
      vendorId = vendor.id;
    }
  }

  // Vendor-scoped keys share the `finance:${vendorId}:*` namespace so order
  // creation and settlement creation can invalidate them; rider-scoped ones
  // share `finance:rider:${riderId}:*`, invalidated by createSettlement.
  // The `:v2` suffix retires payloads cached before orderNumber/receiverPhone
  // were added to the item shape (both invalidation globs still match it).
  const cacheKey = vendorId ? `finance:${vendorId}:unsettled:v2` : `finance:rider:${riderId}:unsettled:v2`;
  const cached = await readFinanceCache<UnsettledOrdersResult>(cacheKey);
  if (cached) return cached;

  // Rider leg (cash collected but not yet remitted to office) is tracked
  // independently of the vendor leg (payment_status) - see cod_collections
  // schema comment. Only orders that actually reached a delivery attempt are
  // eligible - collected_at is only ever set by a delivery/partial-delivery
  // transition, so it's the honest "this needs to be settled" signal even when
  // the amount collected was corrected down to 0 (collected_amount > 0 would
  // wrongly hide those from the ledger instead of settling them at 0).
  // A cancelled order is void - it must never surface as needing settlement,
  // even if cash was recorded as collected before the cancellation happened
  // (e.g. a super_admin force-cancelling an already-delivered parcel).
  const notCancelled: Prisma.cod_collectionsWhereInput = { parcels: { status: { not: parcel_status.cancelled } } };
  // An RTV/RTO parcel (genuine return order_type, or a plain delivery bounced
  // back to returned_to_vendor) never had COD collected on the rider's leg -
  // collected_amount is 0 - so there's nothing for the rider to settle for it.
  // It still owes the vendor a return delivery charge, so it stays visible on
  // the vendor leg (see isReturnToVendor below) - only excluded here.
  const riderNotReturned: Prisma.cod_collectionsWhereInput = {
    parcels: {
      status: { notIn: [parcel_status.cancelled, parcel_status.returned_to_vendor] },
      order_type: { not: order_type.return },
    },
  };

  const where: Prisma.cod_collectionsWhereInput = riderId
    ? {
        rider_id: riderId,
        rider_payment_status: payment_status.pending,
        collected_at: { not: null },
        // Not already bundled into a rider statement. The two legs settle the
        // same collection independently, so this is scoped to rider statements
        // only - a vendor statement on this collection must not hide it here.
        settlement_items: { none: { settlements: { payee_type: "rider" } } },
        ...riderNotReturned,
      }
    : {
        ...(vendorId ? { vendor_id: vendorId } : {}),
        payment_status: payment_status.pending,
        // Only orders that reached delivery are settleable - this excludes
        // not-yet-delivered orders and mirrors the rider leg's guard.
        collected_at: { not: null },
        // Not already bundled into a vendor statement (see rider leg note).
        settlement_items: { none: { settlements: { payee_type: "vendor" } } },
        ...notCancelled,
      };

  const collections = await prisma.cod_collections.findMany({
    where,
    include: {
      parcels: {
        select: {
          order_number: true,
          tracking_id: true,
          delivery_charge: true,
          order_type: true,
          status: true,
          pickup_rider_id: true,
          delivery_rider_id: true,
          parties_parcels_receiver_idToparties: { select: { name: true, phone: true, address: true } },
          locations_parcels_destination_location_idTolocations: {
            select: { name: true, city: true, district: true },
          },
          // Only needed for the rider leg - see location resolution below.
          locations_parcels_origin_location_idTolocations: { select: { name: true } },
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const items: UnsettledOrderItem[] = collections.map((c) => {
    const collected = Number(c.collected_amount);
    // A parcel returned to the vendor - genuine return leg or a plain RTO
    // bounce-back alike - is billed its delivery_charge same as any other
    // settled order (see billing.service.ts's EARNED_CHARGE_SQL).
    const isReturnToVendor =
      c.parcels.order_type === "return" || c.parcels.status === parcel_status.returned_to_vendor;
    const deliveryCharge = Number(c.parcels.delivery_charge);
    // Both legs settle on the cash actually collected, which is less than the
    // declared COD on a partial delivery. Vendor leg owes (collected - delivery
    // charge); rider leg owes exactly what they collected. codAmount is the
    // declared COD due (informational); collectedAmount is what actually came
    // in and is what netPayable is computed from.
    const codAmount = Number(c.cod_amount);
    const collectedAmount = collected;
    const netPayable = riderId ? collected : collected - deliveryCharge;
    // A rider's row can be either leg of the parcel - show wherever that leg
    // actually happened rather than always defaulting to one direction.
    const location = riderId
      ? c.parcels.pickup_rider_id === riderId
        ? (c.parcels.locations_parcels_origin_location_idTolocations?.name ?? null)
        : c.parcels.delivery_rider_id === riderId
          ? (c.parcels.locations_parcels_destination_location_idTolocations?.name ?? null)
          : null
      : null;
    return {
      id: c.parcel_id,
      codCollectionId: c.id,
      orderNumber: c.parcels.order_number,
      trackingId: c.parcels.tracking_id,
      receiverName: c.parcels.parties_parcels_receiver_idToparties.name,
      receiverPhone: c.parcels.parties_parcels_receiver_idToparties.phone,
      receiverAddress: c.parcels.parties_parcels_receiver_idToparties.address,
      destination: formatLocation(c.parcels.locations_parcels_destination_location_idTolocations),
      location,
      orderType: c.parcels.order_type,
      isReturnToVendor,
      codAmount,
      collectedAmount,
      deliveryCharge,
      netPayable,
    };
  });

  const totalCod = items.reduce((sum, item) => sum + item.codAmount, 0);
  const totalDeliveryCharge = items.reduce((sum, item) => sum + item.deliveryCharge, 0);
  const totalNetPayable = items.reduce((sum, item) => sum + item.netPayable, 0);

  const result: UnsettledOrdersResult = {
    items,
    totalCod,
    totalDeliveryCharge,
    totalNetPayable,
  };
  await writeFinanceCache(cacheKey, result);
  return result;
}

function generateStatementId(payeeType: "rider" | "vendor", date = new Date()) {
  const prefix = payeeType === "rider" ? "STM-R" : "STM-V";
  return `${prefix}-${getDatePart(date)}-${randomBase32(6)}`;
}

// Admin-only: bundles a rider's or vendor's selected pending cod_collections
// into a pending settlement statement. This only earmarks the orders; the
// statement is settled (and the underlying collections marked paid) later in
// payForSettlement, so "paid"/"settled" always reflects money that moved.
export async function createSettlement(
  actor: Actor,
  input: CreateSettlementInput,
): Promise<CreateSettlementResult> {
  const { payeeType, targetId, codCollectionIds, settlementDate } = input;

  if (!codCollectionIds || codCollectionIds.length === 0) {
    throw new AppError(400, "At least one order must be selected");
  }
  const parsedDate = new Date(settlementDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new AppError(400, "settlementDate must be a valid date");
  }

  const target =
    payeeType === "rider" ? await resolveRider(actor, targetId) : await resolveVendor(actor, targetId);

  // A collection is eligible only if it isn't already bundled into a statement
  // of the same leg. Membership - not payment_status - is the double-settlement
  // guard now, because a collection stays `pending` until its statement is
  // actually paid (see payForSettlement), so it would otherwise be selectable
  // twice while a statement sits unpaid.
  const eligibleWhere: Prisma.cod_collectionsWhereInput =
    payeeType === "rider"
      ? {
          id: { in: codCollectionIds },
          rider_id: target.id,
          rider_payment_status: payment_status.pending,
          // Only settle orders that reached a delivery attempt - collected_at
          // is the honest signal (see getUnsettledOrders); collected_amount > 0
          // would wrongly reject settling a corrected-to-0 order at 0.
          collected_at: { not: null },
          settlement_items: { none: { settlements: { payee_type: "rider" } } },
          // Mirrors getUnsettledOrders' riderNotReturned guard - RTV/RTO
          // parcels (nothing collected on this leg) must not be settleable
          // into a rider statement even via a direct createSettlement call
          // bypassing the picker UI.
          parcels: {
            status: { not: parcel_status.returned_to_vendor },
            order_type: { not: order_type.return },
          },
        }
      : {
          id: { in: codCollectionIds },
          vendor_id: target.id,
          payment_status: payment_status.pending,
          collected_at: { not: null },
          settlement_items: { none: { settlements: { payee_type: "vendor" } } },
        };

  const collections = await prisma.cod_collections.findMany({
    where: eligibleWhere,
    include: { parcels: { select: { delivery_charge: true } } },
  });

  if (collections.length !== codCollectionIds.length) {
    throw new AppError(
      400,
      "One or more selected orders are not eligible for settlement (already settled or do not belong to this account)",
    );
  }

  // Gross is the cash actually collected (not the declared COD, which overstates
  // partial deliveries). Vendor payout is gross minus the delivery charge -
  // a parcel returned to the vendor (return leg or plain RTO bounce-back) is
  // billed its delivery_charge same as any other settled order.
  const grossAmount = collections.reduce((sum, c) => sum + Number(c.collected_amount), 0);
  const payableAmount =
    payeeType === "rider"
      ? collections.reduce((sum, c) => sum + Number(c.collected_amount), 0)
      : collections.reduce((sum, c) => sum + Number(c.collected_amount) - Number(c.parcels.delivery_charge), 0);
  const statementId = generateStatementId(payeeType);

  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.settlements.create({
      data: {
        statement_id: statementId,
        payee_type: payeeType,
        rider_id: payeeType === "rider" ? target.id : null,
        vendor_id: payeeType === "vendor" ? target.id : null,
        amount: grossAmount,
        payable_amount: payableAmount,
        settlement_date: parsedDate,
        status: "pending",
        settled_by: actor.id,
      },
    });

    await tx.settlement_items.createMany({
      data: collections.map((c) => ({
        settlement_id: created.id,
        cod_collection_id: c.id,
        amount: payeeType === "rider" ? Number(c.collected_amount) : Number(c.collected_amount) - Number(c.parcels.delivery_charge),
      })),
    });

    // The collections are intentionally NOT marked paid here. Creating a
    // statement only earmarks these orders (enforced by the membership guard in
    // eligibleWhere); the payment_status / remitted_amount writes happen in
    // payForSettlement, so "paid" always means money actually moved.

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: created.id,
        action: "CREATE_SETTLEMENT",
        new_data: { statementId, payeeType, targetId: target.id, amount: grossAmount, payableAmount },
      },
    });

    return created;
  });

  if (payeeType === "rider") {
    await invalidateRiderFinanceCache(target.id);
  } else {
    await invalidateVendorFinanceCache(target.id);
  }

  const targetUserId = target.user_id;
  if (targetUserId && targetUserId !== actor.id) {
    await createNotification(
      targetUserId,
      `COD Statement ${statementId} created`,
      `A statement of Rs. ${payableAmount} across ${collections.length} order(s) is pending payment.`,
      null,
      "cod_settlement",
      payeeType === "rider" ? "/finance" : "/finance/settlements",
    );
  }

  return {
    id: settlement.id,
    statementId: settlement.statement_id,
    payeeType,
    amount: grossAmount,
    payableAmount,
    settlementDate: settlement.settlement_date ? formatNepalDate(settlement.settlement_date) : null,
    status: settlement.status,
    paymentMethod: settlement.payment_method,
    payments: [],
    remark: settlement.remark,
    paidAmount: 0,
    remainingAmount: Math.abs(payableAmount),
  };
}

// Money here is Decimal(12,2) in the database but plain floats in transit, so
// every running total is snapped back to paisa before it's compared. Without
// this, 1000 + 2000.00000000001 never equals 3000 and a fully-paid statement
// would sit at partially_paid forever.
const round2 = (value: number): number => Math.round(value * 100) / 100;

// `breakdown` / `payments` are Json columns, so anything could be in there -
// including nulls from rows written before the column existed.
function toPaymentLines(value: Prisma.JsonValue | null): SettlementPaymentInput[] {
  return Array.isArray(value) ? (value as unknown as SettlementPaymentInput[]) : [];
}

// Serialises the state transitions on one statement. Every writer below reads
// the statement, decides what to do from its status and paid_amount, then
// writes - and that read has to happen under this lock, inside the same
// transaction as the write, or two callers interleave.
//
// Recording two instalments at the same moment is the case that costs money:
// both read paid_amount = 0, both find the full amount outstanding so both pass
// the overpayment check, and then the second write overwrites the first one's
// total while its settlement_payments row survives - leaving the ledger saying
// Rs. 4,000 was handed over and the statement header saying Rs. 2,000. The
// same interleaving lets a revert skip unwinding collections it should have
// unwound, and lets an edit or a cancel land on a statement that acquired a
// payment a moment earlier.
//
// Locked by id in raw SQL because Prisma's fluent API has no FOR UPDATE; the
// caller then re-reads through Prisma inside the transaction. Read Committed
// makes both steps see whatever the previous holder of the lock committed.
async function lockSettlement(tx: Prisma.TransactionClient, settlementId: string): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM settlements WHERE id = ${settlementId}::uuid FOR UPDATE`,
  );
  if (locked.length === 0) {
    throw new AppError(404, "Settlement not found");
  }
}

// Interactive transactions now wait on a row lock before they do any work, so
// the default 2s/5s budget is too tight: a statement being paid while another
// instalment is mid-flight would abort rather than queue. Generous enough to
// absorb the wait, still short enough that a genuinely stuck lock surfaces as
// an error instead of pinning a connection.
const SETTLEMENT_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const isPdfPath = (filePath: string): boolean => filePath.toLowerCase().endsWith(".pdf");

function toDocumentResult(doc: {
  id: string;
  kind: string;
  settlement_payment_id: string | null;
  file_path: string;
  created_at: Date;
}): SettlementDocumentResult {
  return {
    id: doc.id,
    kind: doc.kind === "tax_invoice" ? "tax_invoice" : "receipt",
    paymentId: doc.settlement_payment_id,
    isPdf: isPdfPath(doc.file_path),
    uploadedAt: doc.created_at.toISOString(),
  };
}

// Admin-only: records one payment against a statement. A single call may split
// the money across methods (e.g. part cash, part online), and may pay only part
// of what's owed - Rs. 1,000 now and Rs. 2,000 next week is two calls, each
// leaving its own instalment row with its own date and evidence. The statement
// only flips to settled once the instalments add up to the full amount; until
// then it sits at partially_paid and the bundled orders stay unpaid, because a
// half-received payout hasn't actually cleared any individual order.
export async function payForSettlement(
  actor: Actor,
  settlementId: string,
  input: PaySettlementInput,
): Promise<CreateSettlementResult> {
  const { payments, remark, paymentReceiptPaths, taxInvoicePaths } = input;

  if (!payments || payments.length === 0) {
    throw new AppError(400, "At least one payment is required");
  }
  // Payment methods are configurable (Cash, Online, eSewa, Bank, ...) and
  // managed by super admins, so validate each submitted method against the
  // currently-active set rather than a hardcoded list.
  const activeMethods = await getActivePaymentMethodNames();
  const activeMethodSet = new Set(activeMethods.map((m) => m.toLowerCase()));
  for (const p of payments) {
    if (!activeMethodSet.has(p.method.trim().toLowerCase())) {
      throw new AppError(400, `Unknown payment method "${p.method}"`);
    }
    if (p.amount < 0) {
      throw new AppError(400, "Payment amount cannot be negative");
    }
  }

  const paidTotal = round2(payments.reduce((sum, p) => sum + p.amount, 0));

  // Everything from here on reads state another instalment could be changing
  // right now - the statement's status and how much has already been handed
  // over - so it happens under the row lock, in the same transaction as the
  // write it decides. See lockSettlement.
  const {
    settlement: updated,
    payment: instalment,
    payableAmount,
    expectedTotal,
    newPaidTotal,
    allPayments,
    fullySettled,
    riderId,
    vendorId,
  } = await prisma.$transaction(async (tx) => {
    await lockSettlement(tx, settlementId);

    const settlement = await tx.settlements.findUnique({
      where: { id: settlementId },
      include: {
        settlement_items: {
          include: { cod_collections: { select: { id: true, collected_amount: true } } },
        },
        settlement_payments: { orderBy: { paid_at: "asc" } },
      },
    });
    if (!settlement) {
      throw new AppError(404, "Settlement not found");
    }
    if (settlement.status === "settled") {
      throw new AppError(400, "This settlement has already been paid");
    }
    if (settlement.status === "cancelled") {
      throw new AppError(400, "This settlement has been cancelled");
    }

    const payableAmount = Number(settlement.payable_amount ?? settlement.amount);
    // A negative payable means the COD collected was less than the delivery
    // charges, so the vendor owes the office rather than the other way round. The
    // recorded payments then represent cash received FROM the vendor, and must
    // total the absolute amount owed. (Rider legs are always >= 0.)
    const vendorOwesOffice = payableAmount < 0;
    const expectedTotal = Math.abs(payableAmount);
    const alreadyPaid = Number(settlement.paid_amount);
    const outstanding = round2(expectedTotal - alreadyPaid);

    // A statement can legitimately total Rs. 0 (every bundled order corrected to
    // zero COD), and closing it still deserves a record of how - so a zero-amount
    // instalment is only rejected when there is actually money outstanding.
    if (paidTotal <= 0 && expectedTotal > 0) {
      throw new AppError(400, "Payment amount must be greater than zero");
    }
    if (paidTotal > outstanding) {
      throw new AppError(
        400,
        alreadyPaid > 0
          ? `Payment total (Rs. ${paidTotal}) is more than the Rs. ${outstanding} still outstanding on this statement`
          : vendorOwesOffice
            ? `Payment total (Rs. ${paidTotal}) is more than the Rs. ${expectedTotal} owed by the vendor`
            : `Payment total (Rs. ${paidTotal}) is more than the payable amount (Rs. ${expectedTotal})`,
      );
    }

    const newPaidTotal = round2(alreadyPaid + paidTotal);
    const fullySettled = round2(expectedTotal - newPaidTotal) === 0;
    const instalmentMethodSummary = Array.from(new Set(payments.map((p) => p.method))).join(", ");
    // The statement header keeps showing every line ever recorded against it,
    // across instalments - so a statement paid Rs. 1,000 cash then Rs. 2,000 by
    // bank still reads "Cash, Bank" rather than only the most recent method.
    const allPayments = [
      ...settlement.settlement_payments.flatMap((sp) => toPaymentLines(sp.breakdown)),
      ...payments,
    ];
    const paymentMethodSummary = Array.from(new Set(allPayments.map((p) => p.method))).join(", ");

    const payment = await tx.settlement_payments.create({
      data: {
        settlement_id: settlementId,
        amount: paidTotal,
        method: instalmentMethodSummary,
        breakdown: payments as unknown as Prisma.InputJsonValue,
        remark: remark?.trim() || null,
        recorded_by: actor.id,
      },
    });

    const documentRows = [
      ...(paymentReceiptPaths ?? []).map((filePath) => ({ kind: "receipt", filePath })),
      ...(taxInvoicePaths ?? []).map((filePath) => ({ kind: "tax_invoice", filePath })),
    ];
    if (documentRows.length > 0) {
      await tx.settlement_documents.createMany({
        data: documentRows.map((doc) => ({
          settlement_id: settlementId,
          settlement_payment_id: payment.id,
          kind: doc.kind,
          file_path: doc.filePath,
          uploaded_by: actor.id,
        })),
      });
    }

    const result = await tx.settlements.update({
      where: { id: settlementId },
      data: {
        status: fullySettled ? "settled" : "partially_paid",
        payment_method: paymentMethodSummary,
        payments: allPayments as unknown as Prisma.InputJsonValue,
        paid_amount: newPaidTotal,
        // Optional: store null rather than "" so the UI's `remark && ...` checks
        // treat "no remark" the same as a statement that never had one. An
        // instalment without its own note leaves the statement's note alone.
        ...(remark?.trim() ? { remark: remark.trim() } : {}),
        // Only a completed payout has a "settled by" - a part payment leaves
        // the statement open, so attributing it here would be a lie the revert
        // path would then have to undo.
        ...(fullySettled ? { settled_by: actor.id } : {}),
      },
    });

    // Only once the payout has cleared in full does the money behind each
    // bundled collection count as remitted: a part payment can't be assigned
    // to particular orders, so marking any of them paid would overstate it.
    // remitted_amount / rider_remitted_amount vary per row (each equals that
    // row's collected_amount - the cash actually collected), so this can't be
    // a single shared updateMany.
    if (fullySettled) {
      const settledAt = new Date();
      if (settlement.payee_type === "rider") {
        await Promise.all(
          settlement.settlement_items.map((si) =>
            tx.cod_collections.update({
              where: { id: si.cod_collection_id },
              data: {
                rider_payment_status: payment_status.paid,
                rider_remitted_amount: si.cod_collections.collected_amount,
                rider_settled_at: settledAt,
              },
            }),
          ),
        );
      } else {
        await Promise.all(
          settlement.settlement_items.map((si) =>
            tx.cod_collections.update({
              where: { id: si.cod_collection_id },
              data: {
                payment_status: payment_status.paid,
                remitted_amount: si.cod_collections.collected_amount,
              },
            }),
          ),
        );
      }
    }

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: fullySettled ? "PAY_SETTLEMENT" : "PART_PAY_SETTLEMENT",
        new_data: {
          statementId: result.statement_id,
          paymentMethod: instalmentMethodSummary,
          amount: paidTotal,
          paidAmount: newPaidTotal,
          payableAmount,
          status: result.status,
        },
      },
    });

    // Money has moved, so the books say so - in the same transaction that
    // moved it. A rider statement debits cash and clears that rider's holding;
    // a vendor statement settles their account in whichever direction the
    // payable points.
    //
    // This runs for a part payment too, not just a completed one: the cash
    // genuinely changed hands either way, and the postings are derived from the
    // statement's paid amount rather than its settled/unsettled status.
    await syncSettlementPostings(tx, [settlementId], {
      actorId: actor.id,
      reason: "settlement paid",
    });

    return {
      settlement: result,
      payment,
      payableAmount,
      expectedTotal,
      newPaidTotal,
      allPayments,
      fullySettled,
      riderId: settlement.rider_id,
      vendorId: settlement.vendor_id,
    };
  }, SETTLEMENT_TX_OPTIONS);

  if (riderId) {
    await invalidateRiderFinanceCache(riderId);
  } else if (vendorId) {
    await invalidateVendorFinanceCache(vendorId);
    // A completed payout debits the vendor's running account, so it can push
    // them across a credit threshold just as a delivery can. A part payment
    // doesn't - the balance is derived from the collections above, which only
    // move once the payout clears. Fire-and-forget.
    if (fullySettled) evaluateVendorBillingAsync(vendorId);
  }

  return {
    id: updated.id,
    statementId: updated.statement_id,
    payeeType: updated.payee_type as "rider" | "vendor",
    amount: Number(updated.amount),
    payableAmount,
    settlementDate: updated.settlement_date ? formatNepalDate(updated.settlement_date) : null,
    status: updated.status,
    paymentMethod: updated.payment_method,
    payments: allPayments,
    remark: updated.remark,
    paidAmount: newPaidTotal,
    remainingAmount: round2(expectedTotal - newPaidTotal),
    paymentId: instalment.id,
  };
}

// Admin-only: attaches payment proof (receipt/tax invoice) to a statement that
// already has money recorded against it. Deliberately a separate step from
// paying - the proof is evidence the transfer happened, so it only makes sense
// once the payment itself is on record, and staff shouldn't have to have the
// file in hand at the moment they submit the payment amounts.
//
// Every uploaded file becomes its own row, so this adds to what's there rather
// than replacing it: a statement paid in instalments ends up with a receipt per
// instalment, and a single transfer photographed twice keeps both pictures.
// Pass `replaceDocumentId` for the one case that genuinely is a replacement -
// swapping out a wrong or unreadable file.
export async function attachSettlementDocuments(
  actor: Actor,
  settlementId: string,
  input: AttachSettlementDocumentsInput,
): Promise<{ id: string; documents: SettlementDocumentResult[] }> {
  const { paymentReceiptPaths = [], taxInvoicePaths = [], paymentId, replaceDocumentId } = input;
  const incoming = [
    ...paymentReceiptPaths.map((filePath) => ({ kind: "receipt" as const, filePath })),
    ...taxInvoicePaths.map((filePath) => ({ kind: "tax_invoice" as const, filePath })),
  ];
  if (incoming.length === 0) {
    throw new AppError(400, "At least one document is required");
  }
  if (replaceDocumentId && incoming.length > 1) {
    throw new AppError(400, "Only one file can be uploaded when replacing a document");
  }

  // Under the row lock like the other writers: a revert landing between these
  // checks and the insert deletes the statement's instalments and documents,
  // and this would then attach proof to a statement that is pending again.
  await prisma.$transaction(async (tx) => {
    await lockSettlement(tx, settlementId);

    const settlement = await tx.settlements.findUnique({ where: { id: settlementId } });
    if (!settlement) {
      throw new AppError(404, "Settlement not found");
    }
    if (settlement.status !== "settled" && settlement.status !== "partially_paid") {
      throw new AppError(400, "Documents can only be attached to a statement with a payment recorded");
    }

    // Both ids are caller-supplied, so confirm they belong to *this* statement -
    // otherwise proof could be moved onto, or lifted off, someone else's payout.
    if (paymentId) {
      const payment = await tx.settlement_payments.findFirst({
        where: { id: paymentId, settlement_id: settlementId },
        select: { id: true },
      });
      if (!payment) throw new AppError(404, "Payment not found on this statement");
    }
    if (replaceDocumentId) {
      const existing = await tx.settlement_documents.findFirst({
        where: { id: replaceDocumentId, settlement_id: settlementId },
        select: { id: true },
      });
      if (!existing) throw new AppError(404, "Document not found on this statement");
    }

    if (replaceDocumentId) {
      // Guaranteed present: `incoming` is non-empty and, under a replace,
      // holds exactly one file - both checked above.
      const doc = incoming[0]!;
      await tx.settlement_documents.update({
        where: { id: replaceDocumentId },
        data: {
          kind: doc.kind,
          file_path: doc.filePath,
          uploaded_by: actor.id,
          ...(paymentId ? { settlement_payment_id: paymentId } : {}),
        },
      });
    } else {
      await tx.settlement_documents.createMany({
        data: incoming.map((doc) => ({
          settlement_id: settlementId,
          settlement_payment_id: paymentId ?? null,
          kind: doc.kind,
          file_path: doc.filePath,
          uploaded_by: actor.id,
        })),
      });
    }

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: replaceDocumentId ? "REPLACE_SETTLEMENT_DOCUMENT" : "ATTACH_SETTLEMENT_DOCUMENTS",
        new_data: {
          paymentId: paymentId ?? null,
          replacedDocumentId: replaceDocumentId ?? null,
          receiptsAttached: paymentReceiptPaths.length,
          taxInvoicesAttached: taxInvoicePaths.length,
        },
      },
    });
  }, SETTLEMENT_TX_OPTIONS);

  const documents = await prisma.settlement_documents.findMany({
    where: { settlement_id: settlementId },
    orderBy: { created_at: "asc" },
  });

  return { id: settlementId, documents: documents.map(toDocumentResult) };
}

// Admin-only: drops one proof off a statement. Needed once a statement can
// hold several of them - "Replace" can fix a wrong file, but nothing else could
// remove a picture attached to the wrong statement entirely.
export async function deleteSettlementDocument(
  actor: Actor,
  settlementId: string,
  documentId: string,
): Promise<{ id: string; documents: SettlementDocumentResult[] }> {
  const existing = await prisma.settlement_documents.findFirst({
    where: { id: documentId, settlement_id: settlementId },
    select: { id: true, kind: true, file_path: true, settlement_payment_id: true },
  });
  if (!existing) throw new AppError(404, "Document not found on this statement");

  await prisma.$transaction(async (tx) => {
    await tx.settlement_documents.delete({ where: { id: documentId } });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: "DELETE_SETTLEMENT_DOCUMENT",
        // The file itself stays on disk, so a mistaken delete is recoverable
        // from this entry - same as the files orphaned by a replacement.
        old_data: {
          documentId,
          kind: existing.kind,
          filePath: existing.file_path,
          paymentId: existing.settlement_payment_id,
        },
      },
    });
  });

  const documents = await prisma.settlement_documents.findMany({
    where: { settlement_id: settlementId },
    orderBy: { created_at: "asc" },
  });

  return { id: settlementId, documents: documents.map(toDocumentResult) };
}

// Admin-only, gated by the delegable EDIT_SETTLEMENTS permission: corrects an
// unsettled statement's order list (add/remove cod_collections) after the
// fact. Once any payment is recorded against a statement (via payForSettlement)
// it's immutable - money has already moved, so this always re-checks status
// even though the route middleware also gates on it being unsettled elsewhere.
export async function updateSettlement(
  actor: Actor,
  settlementId: string,
  codCollectionIds: string[],
): Promise<CreateSettlementResult> {
  if (!codCollectionIds || codCollectionIds.length === 0) {
    throw new AppError(400, "A settlement must include at least one order");
  }

  // All of this runs under the row lock: the "still pending" check guards the
  // edit, and the set of orders being added or removed is derived from the
  // statement's current items - both go stale the moment an instalment is
  // recorded against it. Reading them outside the lock would let an edit
  // rewrite the orders behind a statement that had just been paid.
  const { settlement: updated, payeeType, targetId, payableAmount } = await prisma.$transaction(async (tx) => {
    await lockSettlement(tx, settlementId);

    const settlement = await tx.settlements.findUnique({
      where: { id: settlementId },
      include: { settlement_items: { select: { cod_collection_id: true } } },
    });
    if (!settlement) {
      throw new AppError(404, "Settlement not found");
    }
    if (settlement.status !== "pending") {
      throw new AppError(
        400,
        settlement.status === "partially_paid"
          ? "This statement has a payment recorded against it and can no longer be edited"
          : settlement.status === "cancelled"
            ? "This statement has been cancelled and can no longer be edited"
            : "This statement has already been paid and can no longer be edited",
      );
    }

    const payeeType = settlement.payee_type as "rider" | "vendor";
    const targetId = payeeType === "rider" ? settlement.rider_id : settlement.vendor_id;
    if (!targetId) {
      throw new AppError(500, "Settlement is missing its payee");
    }

    const existingIds = new Set(settlement.settlement_items.map((i) => i.cod_collection_id));
    const nextIds = new Set(codCollectionIds);
    const toRemove = settlement.settlement_items.filter((i) => !nextIds.has(i.cod_collection_id));
    const toAddIds = codCollectionIds.filter((id) => !existingIds.has(id));
    const keptIds = codCollectionIds.filter((id) => existingIds.has(id));

    // Orders newly added must belong to the same payee and still be pending
    // settlement - the same eligibility rule createSettlement enforces.
    const eligibleAddWhere: Prisma.cod_collectionsWhereInput =
      payeeType === "rider"
        ? { id: { in: toAddIds }, rider_id: targetId, rider_payment_status: payment_status.pending, collected_at: { not: null } }
        : { id: { in: toAddIds }, vendor_id: targetId, payment_status: payment_status.pending, collected_at: { not: null } };

    // Read through `tx`, not `prisma`: these run under the statement's row lock
    // (see lockSettlement), so they must be part of the same transaction.
    const [toAddCollections, keptCollections] = await Promise.all([
      toAddIds.length > 0
        ? tx.cod_collections.findMany({
            where: eligibleAddWhere,
            include: { parcels: { select: { delivery_charge: true } } },
          })
        : Promise.resolve([]),
      keptIds.length > 0
        ? tx.cod_collections.findMany({
            where: { id: { in: keptIds } },
            include: { parcels: { select: { delivery_charge: true } } },
          })
        : Promise.resolve([]),
    ]);

    if (toAddCollections.length !== toAddIds.length) {
      throw new AppError(
        400,
        "One or more orders being added are not eligible (already settled or belong to a different account)",
      );
    }

    const allCollections = [...keptCollections, ...toAddCollections];
    const grossAmount = allCollections.reduce((sum, c) => sum + Number(c.collected_amount), 0);
    const payableAmount =
      payeeType === "rider"
        ? grossAmount
        : allCollections.reduce((sum, c) => sum + Number(c.collected_amount) - Number(c.parcels.delivery_charge), 0);

    if (toRemove.length > 0) {
      const removedIds = toRemove.map((i) => i.cod_collection_id);
      await tx.settlement_items.deleteMany({
        where: { settlement_id: settlement.id, cod_collection_id: { in: removedIds } },
      });
      if (payeeType === "rider") {
        await tx.cod_collections.updateMany({
          where: { id: { in: removedIds } },
          data: { rider_payment_status: payment_status.pending, rider_remitted_amount: 0, rider_settled_at: null },
        });
      } else {
        await tx.cod_collections.updateMany({
          where: { id: { in: removedIds } },
          data: { payment_status: payment_status.pending, remitted_amount: 0 },
        });
      }
    }

    if (toAddCollections.length > 0) {
      await tx.settlement_items.createMany({
        data: toAddCollections.map((c) => ({
          settlement_id: settlement.id,
          cod_collection_id: c.id,
          amount: payeeType === "rider" ? Number(c.collected_amount) : Number(c.collected_amount) - Number(c.parcels.delivery_charge),
        })),
      });
      if (payeeType === "rider") {
        await Promise.all(
          toAddCollections.map((c) =>
            tx.cod_collections.update({
              where: { id: c.id },
              data: { rider_payment_status: payment_status.paid, rider_remitted_amount: c.collected_amount, rider_settled_at: new Date() },
            }),
          ),
        );
      } else {
        await Promise.all(
          toAddCollections.map((c) =>
            tx.cod_collections.update({
              where: { id: c.id },
              data: { payment_status: payment_status.paid, remitted_amount: c.collected_amount },
            }),
          ),
        );
      }
    }

    const result = await tx.settlements.update({
      where: { id: settlement.id },
      data: { amount: grossAmount, payable_amount: payableAmount },
    });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlement.id,
        action: "EDIT_SETTLEMENT",
        old_data: {
          codCollectionIds: Array.from(existingIds),
          amount: Number(settlement.amount),
          payableAmount: Number(settlement.payable_amount ?? settlement.amount),
        },
        new_data: { codCollectionIds, amount: grossAmount, payableAmount },
      },
    });

    // Only an unsettled statement is editable, so in practice there is nothing
    // posted to restate. Syncing anyway costs one indexed lookup and means this
    // path stays correct if that rule is ever relaxed - the ledger should not
    // depend on a guard living in another function.
    await syncSettlementPostings(tx, [settlement.id], {
      actorId: actor.id,
      reason: "settlement order list edited",
    });

    return { settlement: result, payeeType, targetId, payableAmount };
  }, SETTLEMENT_TX_OPTIONS);

  if (payeeType === "rider") {
    await invalidateRiderFinanceCache(targetId);
  } else {
    await invalidateVendorFinanceCache(targetId);
  }

  return {
    id: updated.id,
    statementId: updated.statement_id,
    payeeType,
    amount: Number(updated.amount),
    payableAmount,
    settlementDate: updated.settlement_date ? formatNepalDate(updated.settlement_date) : null,
    status: updated.status,
    paymentMethod: updated.payment_method,
    payments: toPaymentLines(updated.payments),
    remark: updated.remark,
    // Only a pending statement reaches here, so nothing has been paid on it.
    paidAmount: 0,
    remainingAmount: Math.abs(payableAmount),
  };
}

// Admin-only, gated by the delegable EDIT_SETTLEMENTS permission (same gate as
// updateSettlement): undoes a mistaken "Make Payment" action. Flips a settled
// (or partially paid) statement back to pending and resets every bundled
// cod_collections leg back to unpaid - the exact inverse of the writes
// payForSettlement made. The statement and its settlement_items are left intact
// (not deleted), so it re-enters the normal pending workflow: editable via
// updateSettlement, payable again via payForSettlement.
export async function revertSettlement(
  actor: Actor,
  settlementId: string,
  remark: string,
): Promise<CreateSettlementResult> {
  // Read under the row lock: `wasSettled` decides whether the bundled
  // collections get unwound, so reading it before an instalment commits would
  // leave them marked paid against a statement that is pending again.
  const { settlement: updated, wasSettled, riderId, vendorId } = await prisma.$transaction(async (tx) => {
    await lockSettlement(tx, settlementId);

    const settlement = await tx.settlements.findUnique({
      where: { id: settlementId },
      include: { settlement_items: { select: { cod_collection_id: true } } },
    });
    if (!settlement) {
      throw new AppError(404, "Settlement not found");
    }
    if (settlement.status !== "settled" && settlement.status !== "partially_paid") {
      throw new AppError(400, "Only a statement with a payment recorded can be reverted");
    }

    const previousPayments = toPaymentLines(settlement.payments);
    const wasSettled = settlement.status === "settled";
    // Kept for the audit entry: the instalments and proof rows are deleted below,
    // so this is the only remaining record that they existed. The files stay on
    // disk, so a revert done by mistake is recoverable from here.
    const [previousInstalments, previousDocuments] = await Promise.all([
      tx.settlement_payments.findMany({
        where: { settlement_id: settlementId },
        orderBy: { paid_at: "asc" },
      }),
      tx.settlement_documents.findMany({
        where: { settlement_id: settlementId },
        orderBy: { created_at: "asc" },
      }),
    ]);

    const result = await tx.settlements.update({
      where: { id: settlementId },
      data: {
        status: "pending",
        payment_method: null,
        payments: Prisma.DbNull,
        paid_amount: 0,
        settled_by: null,
        remark: remark.trim(),
        // Legacy single-document columns: cleared alongside the rows below so a
        // reverted statement doesn't keep serving the old proof.
        payment_receipt_path: null,
        tax_invoice_path: null,
      },
    });

    // A reverted statement is unpaid again, so the instalments and the proof of
    // them have to go with it - otherwise paying it a second time would show a
    // history mixing payments that were undone with ones that stand. The
    // documents cascade from the instalments, but any attached to the statement
    // as a whole would survive that, so delete by statement.
    await tx.settlement_documents.deleteMany({ where: { settlement_id: settlementId } });
    await tx.settlement_payments.deleteMany({ where: { settlement_id: settlementId } });

    // Only a fully settled statement ever marked its collections paid (a part
    // payment leaves them pending), so only that case needs unwinding.
    if (wasSettled) {
      const collectionIds = settlement.settlement_items.map((si) => si.cod_collection_id);
      if (settlement.payee_type === "rider") {
        await tx.cod_collections.updateMany({
          where: { id: { in: collectionIds } },
          data: { rider_payment_status: payment_status.pending, rider_remitted_amount: 0, rider_settled_at: null },
        });
      } else {
        await tx.cod_collections.updateMany({
          where: { id: { in: collectionIds } },
          data: { payment_status: payment_status.pending, remitted_amount: 0 },
        });
      }
    }

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: "REVERT_SETTLEMENT",
        old_data: {
          status: settlement.status,
          paymentMethod: settlement.payment_method,
          payments: previousPayments as unknown as Prisma.InputJsonValue,
          paidAmount: Number(settlement.paid_amount),
          instalments: previousInstalments.map((sp) => ({
            id: sp.id,
            amount: Number(sp.amount),
            method: sp.method,
            paidAt: sp.paid_at.toISOString(),
          })),
          documents: previousDocuments.map((doc) => ({
            id: doc.id,
            kind: doc.kind,
            filePath: doc.file_path,
          })),
          remark: settlement.remark,
        },
        new_data: { status: "pending", remark: remark.trim() },
      },
    });

    return { settlement: result, wasSettled, riderId: settlement.rider_id, vendorId: settlement.vendor_id };
  }, SETTLEMENT_TX_OPTIONS);

  if (riderId) {
    await invalidateRiderFinanceCache(riderId);
  } else if (vendorId) {
    await invalidateVendorFinanceCache(vendorId);
    // Undoing a completed payout credits the vendor's running account back, so
    // it can pull them back under a credit threshold just as a payout can push
    // them over it. Undoing a part payment doesn't move the balance, since it
    // never moved the collections. Fire-and-forget.
    if (wasSettled) evaluateVendorBillingAsync(vendorId);
  }

  return {
    id: updated.id,
    statementId: updated.statement_id,
    payeeType: updated.payee_type as "rider" | "vendor",
    amount: Number(updated.amount),
    payableAmount: Number(updated.payable_amount ?? updated.amount),
    settlementDate: updated.settlement_date ? formatNepalDate(updated.settlement_date) : null,
    status: updated.status,
    paymentMethod: updated.payment_method,
    payments: [],
    remark: updated.remark,
    paidAmount: 0,
    remainingAmount: Math.abs(Number(updated.payable_amount ?? updated.amount)),
  };
}

// Who may read one statement: staff see any, a vendor/rider only their own,
// and a sales account only its own clients'. Shared by the detail endpoint and
// the document download so the two can never drift apart - the download is the
// only path that hands out a decrypted file, so it must not have its own copy
// of this logic.
async function assertSettlementAccess(
  actor: Actor,
  settlement: {
    payee_type: string;
    rider_id: string | null;
    vendor_id: string | null;
    vendors?: { sales_user_id: string | null } | null;
  },
): Promise<void> {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  if (isStaff) return;

  const isSales = actor.roles.includes("sales");

  if (settlement.payee_type === "rider") {
    if (isSales) throw new AppError(403, "Not authorized to view rider settlements");
    const rider = await prisma.riders.findFirst({ where: { user_id: actor.id, deleted_at: null } });
    if (!rider || rider.id !== settlement.rider_id) {
      throw new AppError(403, "Not authorized to view this settlement");
    }
    return;
  }

  if (isSales) {
    if (settlement.vendors?.sales_user_id !== actor.id) {
      throw new AppError(403, "Not authorized to view this client's records");
    }
    return;
  }

  const ownVendorId = await resolveOwnVendorId(actor);
  if (!ownVendorId || ownVendorId !== settlement.vendor_id) {
    throw new AppError(403, "Not authorized to view this settlement");
  }
}

export type SettlementDocumentKind = "receipt" | "tax-invoice";

/**
 * Resolves one of a statement's payment documents for a caller entitled to it.
 * Returns the stored (encrypted-at-rest) path; the controller streams it.
 *
 * `ref` is either a document id - a statement can hold several receipts now, so
 * that's the only way to name a particular one - or, for links written before
 * that, the kind "receipt" / "tax-invoice", which resolves to the newest
 * document of that kind.
 */
export async function getSettlementDocumentPath(
  actor: Actor,
  settlementId: string,
  ref: string,
): Promise<string> {
  const settlement = await prisma.settlements.findUnique({
    where: { id: settlementId },
    select: {
      payee_type: true,
      rider_id: true,
      vendor_id: true,
      payment_receipt_path: true,
      tax_invoice_path: true,
      vendors: { select: { sales_user_id: true } },
    },
  });
  if (!settlement) throw new AppError(404, "Settlement not found");

  await assertSettlementAccess(actor, settlement);

  if (ref === "receipt" || ref === "tax-invoice") {
    const kind = ref === "receipt" ? "receipt" : "tax_invoice";
    const newest = await prisma.settlement_documents.findFirst({
      where: { settlement_id: settlementId, kind },
      orderBy: { created_at: "desc" },
      select: { file_path: true },
    });
    // The legacy columns are the fallback for any row the partial-payments
    // backfill couldn't reach.
    const path =
      newest?.file_path ??
      (kind === "receipt" ? settlement.payment_receipt_path : settlement.tax_invoice_path);
    if (!path) {
      throw new AppError(404, kind === "receipt" ? "No payment receipt attached" : "No tax invoice attached");
    }
    return path;
  }

  const document = await prisma.settlement_documents.findFirst({
    where: { id: ref, settlement_id: settlementId },
    select: { file_path: true },
  });
  if (!document) throw new AppError(404, "Document not found");
  return document.file_path;
}

// Admin-only, gated by the delegable EDIT_SETTLEMENTS permission (same gate as
// updateSettlement/revertSettlement): cancels a statement that hasn't been
// paid yet. Unlike revertSettlement, no payment ever happened here (a pending
// statement only earmarks orders - see createSettlement), so there's no
// payment_status/remitted_amount to unwind. The statement row is kept (status
// -> "cancelled") for the audit trail, but its settlement_items are deleted so
// the bundled orders become eligible for a future statement again.
export async function cancelSettlement(
  actor: Actor,
  settlementId: string,
  remark: string,
): Promise<CreateSettlementResult> {
  // Under the row lock: "still pending" has to be true at the moment the items
  // are deleted, not a moment earlier, or a statement that just took its first
  // instalment loses the orders backing it.
  const { settlement: updated, riderId, vendorId } = await prisma.$transaction(async (tx) => {
    await lockSettlement(tx, settlementId);

    const settlement = await tx.settlements.findUnique({
      where: { id: settlementId },
      include: { settlement_items: { select: { cod_collection_id: true } } },
    });
    if (!settlement) {
      throw new AppError(404, "Settlement not found");
    }
    if (settlement.status !== "pending") {
      throw new AppError(400, "Only a pending statement can be cancelled");
    }

    const collectionIds = settlement.settlement_items.map((si) => si.cod_collection_id);

    await tx.settlement_items.deleteMany({ where: { settlement_id: settlementId } });

    const result = await tx.settlements.update({
      where: { id: settlementId },
      data: { status: "cancelled", remark: remark.trim() },
    });

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: "CANCEL_SETTLEMENT",
        old_data: { status: settlement.status, codCollectionIds: collectionIds, remark: settlement.remark },
        new_data: { status: "cancelled", remark: remark.trim() },
      },
    });

    return { settlement: result, riderId: settlement.rider_id, vendorId: settlement.vendor_id };
  }, SETTLEMENT_TX_OPTIONS);

  if (riderId) {
    await invalidateRiderFinanceCache(riderId);
  } else if (vendorId) {
    await invalidateVendorFinanceCache(vendorId);
  }

  return {
    id: updated.id,
    statementId: updated.statement_id,
    payeeType: updated.payee_type as "rider" | "vendor",
    amount: Number(updated.amount),
    payableAmount: Number(updated.payable_amount ?? updated.amount),
    settlementDate: updated.settlement_date ? formatNepalDate(updated.settlement_date) : null,
    status: updated.status,
    paymentMethod: updated.payment_method,
    payments: [],
    remark: updated.remark,
    // Only a pending (never-paid) statement can be cancelled, so nothing was
    // ever recorded against it and nothing is owed on it any more.
    paidAmount: 0,
    remainingAmount: 0,
  };
}

// Line-item breakdown of a single settlement statement - which orders were
// bundled into it and how much of each was settled. Authorization mirrors
// listSettlements: staff see any statement, vendor/rider/sales are confined
// to their own.
export async function getSettlementDetail(actor: Actor, settlementId: string): Promise<SettlementDetailResult> {
  const settlement = await prisma.settlements.findUnique({
    where: { id: settlementId },
    include: {
      // Oldest first: the payment history reads as a story ("Rs. 1,000 on the
      // 4th, Rs. 2,000 on the 11th"), which only works in the order it happened.
      settlement_payments: {
        orderBy: { paid_at: "asc" },
        include: { settlement_documents: { orderBy: { created_at: "asc" } } },
      },
      settlement_documents: { orderBy: { created_at: "asc" } },
      settlement_items: {
        include: {
          cod_collections: {
            include: {
              parcels: {
                select: {
                  order_number: true,
                  tracking_id: true,
                  delivery_charge: true,
                  delivered_at: true,
                  order_type: true,
                  status: true,
                  pieces: true,
                  weight_kg: true,
                  pickup_rider_id: true,
                  delivery_rider_id: true,
                  parties_parcels_receiver_idToparties: { select: { name: true, phone: true, address: true } },
                  vendors: { select: { business_name: true, client_name: true, phone: true } },
                  // Only meaningful for rider statements - which one applies
                  // depends on whether this rider handled the pickup or the
                  // delivery leg (see the location resolution below).
                  locations_parcels_origin_location_idTolocations: { select: { name: true } },
                  locations_parcels_destination_location_idTolocations: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      riders: {
        select: {
          name: true,
          phone: true,
          user_id: true,
          bank_name: true,
          bank_account_no: true,
          bank_account_holder: true,
        },
      },
      vendors: {
        select: {
          client_name: true,
          business_name: true,
          phone: true,
          email: true,
          address: true,
          pan_vat_no: true,
          user_id: true,
          sales_user_id: true,
          bank_name: true,
          bank_account_no: true,
          bank_account_holder: true,
        },
      },
    },
  });

  if (!settlement) {
    throw new AppError(404, "Settlement not found");
  }

  await assertSettlementAccess(actor, settlement);

  const payeeName = settlement.riders?.name || settlement.vendors?.business_name || settlement.vendors?.client_name || "";
  const payeePhone = settlement.riders?.phone || settlement.vendors?.phone || "";
  const payeeEmail = settlement.vendors?.email ?? null;
  const payeeAddress = settlement.vendors?.address ?? null;
  const payeePan = settlement.vendors?.pan_vat_no ?? null;
  // Rider-then-vendor fallback, same precedence as payeeName/payeePhone above.
  const bankName = settlement.riders?.bank_name ?? settlement.vendors?.bank_name ?? null;
  const bankAccountNo = settlement.riders?.bank_account_no ?? settlement.vendors?.bank_account_no ?? null;
  const bankAccountHolder =
    settlement.riders?.bank_account_holder ?? settlement.vendors?.bank_account_holder ?? null;

  const items: SettlementDetailItem[] = settlement.settlement_items.map((si) => {
    const parcel = si.cod_collections.parcels;
    // A rider settlement's rows can mix pickup and delivery legs for the
    // same rider - show whichever location that leg actually happened at,
    // rather than always defaulting to one or the other.
    const location =
      settlement.payee_type === "rider"
        ? parcel.pickup_rider_id === settlement.rider_id
          ? parcel.locations_parcels_origin_location_idTolocations?.name ?? null
          : parcel.delivery_rider_id === settlement.rider_id
            ? parcel.locations_parcels_destination_location_idTolocations?.name ?? null
            : null
        : null;
    const isReturnToVendor =
      parcel.order_type === "return" || parcel.status === parcel_status.returned_to_vendor;
    return {
      codCollectionId: si.cod_collection_id,
      orderNumber: parcel.order_number,
      trackingId: parcel.tracking_id,
      reference: null,
      receiverName: parcel.parties_parcels_receiver_idToparties.name,
      receiverPhone: parcel.parties_parcels_receiver_idToparties.phone,
      receiverAddress: parcel.parties_parcels_receiver_idToparties.address,
      // Same business_name-then-client_name fallback used for payeeName above.
      vendorName: parcel.vendors?.business_name || parcel.vendors?.client_name || null,
      vendorPhone: parcel.vendors?.phone ?? null,
      orderType: parcel.order_type,
      isReturnToVendor,
      pieces: parcel.pieces,
      weightKg: parcel.weight_kg === null ? null : Number(parcel.weight_kg),
      location,
      codAmount: Number(si.cod_collections.cod_amount),
      collectedAmount: Number(si.cod_collections.collected_amount),
      deliveryCharge: Number(parcel.delivery_charge),
      settledAmount: Number(si.amount),
      deliveredAt: parcel.delivered_at ? parcel.delivered_at.toISOString() : null,
    };
  });

  const payableAmount = Number(settlement.payable_amount ?? settlement.amount);
  const paidAmount = Number(settlement.paid_amount);
  const documents = settlement.settlement_documents.map(toDocumentResult);
  const paymentRecords: SettlementPaymentRecordResult[] = settlement.settlement_payments.map((sp) => ({
    id: sp.id,
    amount: Number(sp.amount),
    method: sp.method,
    breakdown: toPaymentLines(sp.breakdown),
    remark: sp.remark,
    paidAt: sp.paid_at.toISOString(),
    documents: sp.settlement_documents.map(toDocumentResult),
  }));
  // Newest of each kind, for the callers that only ever wanted one document.
  const newestOfKind = (kind: string): string | null =>
    [...settlement.settlement_documents].reverse().find((doc) => doc.kind === kind)?.file_path ?? null;

  return {
    id: settlement.id,
    statementId: settlement.statement_id,
    payeeType: settlement.payee_type as "rider" | "vendor",
    payeeId: (settlement.rider_id ?? settlement.vendor_id) as string,
    payeeName,
    payeePhone,
    payeeEmail,
    payeeAddress,
    payeePan,
    bankName,
    bankAccountNo,
    bankAccountHolder,
    transferDate: settlement.settlement_date ? formatNepalDate(settlement.settlement_date) : null,
    createdAt: settlement.created_at.toISOString(),
    amount: Number(settlement.amount),
    payableAmount,
    paidAmount,
    remainingAmount: round2(Math.abs(payableAmount) - paidAmount),
    status: settlement.status,
    paymentMethod: settlement.payment_method,
    payments: toPaymentLines(settlement.payments),
    paymentRecords,
    documents,
    remark: settlement.remark,
    // Fall back to the legacy columns for statements the partial-payments
    // backfill couldn't reach.
    paymentReceiptPath: newestOfKind("receipt") ?? settlement.payment_receipt_path,
    taxInvoicePath: newestOfKind("tax_invoice") ?? settlement.tax_invoice_path,
    items,
  };
}
