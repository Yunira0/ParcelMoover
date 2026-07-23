import { Prisma } from "../generated/prisma/client";
import { payment_status } from "../generated/prisma/enums";
import prisma from "../lib/prisma";
import redis, { scanAndDelete } from "../lib/redis";
import { AppError } from "../utils/AppError";
import { formatNepalDate } from "../utils/nepalTime";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { resolveOwnVendorId } from "./vendor-scope.service";
import { createNotification } from "./notification.service";

import { getActivePaymentMethodNames } from "./payment-method.service";
import {
  CodPaymentFilter,
  CreateSettlementInput,
  CreateSettlementResult,
  PaySettlementInput,
  SettlementPaymentInput,
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

const MAX_PAGE_SIZE = 100;
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
  const where: Prisma.cod_collectionsWhereInput = {
    vendor_id: vendor.id,
    collected_amount: { gt: 0 },
    ...(statusFilter ? { payment_status: statusFilter } : {}),
  };

  const [settledCount, notSettledCount, total, collections] = await Promise.all([
    prisma.cod_collections.count({
      where: { vendor_id: vendor.id, collected_amount: { gt: 0 }, payment_status: payment_status.paid },
    }),
    prisma.cod_collections.count({
      where: { vendor_id: vendor.id, collected_amount: { gt: 0 }, payment_status: payment_status.pending },
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
  const cacheKey = `finance:${scopeKey}:settlements:${safePage}:${take}:${fromDate?.toISOString() ?? ""}:${toDate?.toISOString() ?? ""}`;
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
  const cacheKey = vendorId ? `finance:${vendorId}:unsettled` : `finance:rider:${riderId}:unsettled`;
  const cached = await readFinanceCache<UnsettledOrdersResult>(cacheKey);
  if (cached) return cached;

  // Rider leg (cash collected but not yet remitted to office) is tracked
  // independently of the vendor leg (payment_status) - see cod_collections
  // schema comment. Only orders where the rider actually collected cash are
  // eligible.
  const where: Prisma.cod_collectionsWhereInput = riderId
    ? {
        rider_id: riderId,
        rider_payment_status: payment_status.pending,
        collected_amount: { gt: 0 },
        // Not already bundled into a rider statement. The two legs settle the
        // same collection independently, so this is scoped to rider statements
        // only - a vendor statement on this collection must not hide it here.
        settlement_items: { none: { settlements: { payee_type: "rider" } } },
      }
    : {
        ...(vendorId ? { vendor_id: vendorId } : {}),
        payment_status: payment_status.pending,
        // Only orders where cash was actually collected are settleable - this
        // excludes not-yet-delivered orders (which would otherwise pay out COD
        // that was never collected) and mirrors the rider leg's guard.
        collected_amount: { gt: 0 },
        // Not already bundled into a vendor statement (see rider leg note).
        settlement_items: { none: { settlements: { payee_type: "vendor" } } },
      };

  const collections = await prisma.cod_collections.findMany({
    where,
    include: {
      parcels: {
        select: {
          tracking_id: true,
          delivery_charge: true,
          parties_parcels_receiver_idToparties: { select: { name: true } },
          locations_parcels_destination_location_idTolocations: {
            select: { name: true, city: true, district: true },
          },
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const items: UnsettledOrderItem[] = collections.map((c) => {
    const collected = Number(c.collected_amount);
    const deliveryCharge = Number(c.parcels.delivery_charge);
    // Both legs settle on the cash actually collected, which is less than the
    // declared COD on a partial delivery. Vendor leg owes (collected - delivery
    // charge); rider leg owes exactly what they collected. The COD column shows
    // the collected amount so the row reconciles (COD - charge = net payable).
    const codAmount = collected;
    const netPayable = riderId ? collected : collected - deliveryCharge;
    return {
      id: c.parcel_id,
      codCollectionId: c.id,
      trackingId: c.parcels.tracking_id,
      receiverName: c.parcels.parties_parcels_receiver_idToparties.name,
      destination: formatLocation(c.parcels.locations_parcels_destination_location_idTolocations),
      codAmount,
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
          collected_amount: { gt: 0 },
          settlement_items: { none: { settlements: { payee_type: "rider" } } },
        }
      : {
          id: { in: codCollectionIds },
          vendor_id: target.id,
          payment_status: payment_status.pending,
          // Only settle orders where cash was actually collected - never pay a
          // vendor for COD that hasn't been collected yet.
          collected_amount: { gt: 0 },
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
  // partial deliveries). Vendor payout is gross minus the delivery charge.
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
  };
}

// Admin-only: records payment against a pending statement and flips it to
// settled. Payments may be split across methods (e.g. part cash, part online)
// but the total must match exactly what's payable - no under/over payment.
export async function payForSettlement(
  actor: Actor,
  settlementId: string,
  input: PaySettlementInput,
): Promise<CreateSettlementResult> {
  const { payments, remark } = input;

  if (!payments || payments.length === 0) {
    throw new AppError(400, "At least one payment is required");
  }
  if (!remark || !remark.trim()) {
    throw new AppError(400, "Remark is required");
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
    if (!(p.amount > 0)) {
      throw new AppError(400, "Payment amount must be greater than 0");
    }
  }

  const settlement = await prisma.settlements.findUnique({
    where: { id: settlementId },
    include: {
      settlement_items: {
        include: { cod_collections: { select: { id: true, collected_amount: true } } },
      },
    },
  });
  if (!settlement) {
    throw new AppError(404, "Settlement not found");
  }
  if (settlement.status === "settled") {
    throw new AppError(400, "This settlement has already been paid");
  }

  const payableAmount = Number(settlement.payable_amount ?? settlement.amount);
  // A negative payable means the COD collected was less than the delivery
  // charges, so the vendor owes the office rather than the other way round. The
  // recorded payments then represent cash received FROM the vendor, and must
  // total the absolute amount owed. (Rider legs are always >= 0.)
  const vendorOwesOffice = payableAmount < 0;
  const expectedTotal = Math.abs(payableAmount);
  const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  if (Math.round(paidTotal * 100) !== Math.round(expectedTotal * 100)) {
    throw new AppError(
      400,
      vendorOwesOffice
        ? `Payment total (Rs. ${paidTotal}) must equal the amount owed by the vendor (Rs. ${expectedTotal})`
        : `Payment total (Rs. ${paidTotal}) must equal the payable amount (Rs. ${expectedTotal})`,
    );
  }
  const paymentMethodSummary = Array.from(new Set(payments.map((p) => p.method))).join(", ");

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.settlements.update({
      where: { id: settlementId },
      data: {
        status: "settled",
        payment_method: paymentMethodSummary,
        payments: payments as unknown as Prisma.InputJsonValue,
        remark: remark.trim(),
        settled_by: actor.id,
      },
    });

    // Money has now actually moved, so mark each bundled collection paid on the
    // relevant leg. remitted_amount / rider_remitted_amount vary per row (each
    // equals that row's collected_amount - the cash actually collected), so
    // this can't be a single shared updateMany.
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

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "settlement",
        entity_id: settlementId,
        action: "PAY_SETTLEMENT",
        new_data: { statementId: result.statement_id, paymentMethod: paymentMethodSummary, payableAmount },
      },
    });

    return result;
  });

  if (settlement.rider_id) {
    await invalidateRiderFinanceCache(settlement.rider_id);
  } else if (settlement.vendor_id) {
    await invalidateVendorFinanceCache(settlement.vendor_id);
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
    payments,
    remark: updated.remark,
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
                  pieces: true,
                  weight_kg: true,
                  parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
                  locations_parcels_destination_location_idTolocations: {
                    select: { name: true, city: true, district: true },
                  },
                },
              },
            },
          },
        },
      },
      riders: { select: { name: true, phone: true, user_id: true } },
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
        },
      },
    },
  });

  if (!settlement) {
    throw new AppError(404, "Settlement not found");
  }

  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isSales = actor.roles.includes("sales") && !isStaff;

  if (!isStaff) {
    if (settlement.payee_type === "rider") {
      if (isSales) throw new AppError(403, "Not authorized to view rider settlements");
      const rider = await prisma.riders.findFirst({ where: { user_id: actor.id, deleted_at: null } });
      if (!rider || rider.id !== settlement.rider_id) {
        throw new AppError(403, "Not authorized to view this settlement");
      }
    } else {
      if (isSales) {
        if (settlement.vendors?.sales_user_id !== actor.id) {
          throw new AppError(403, "Not authorized to view this client's records");
        }
      } else {
        const ownVendorId = await resolveOwnVendorId(actor);
        if (!ownVendorId || ownVendorId !== settlement.vendor_id) {
          throw new AppError(403, "Not authorized to view this settlement");
        }
      }
    }
  }

  const payeeName = settlement.riders?.name || settlement.vendors?.business_name || settlement.vendors?.client_name || "";
  const payeePhone = settlement.riders?.phone || settlement.vendors?.phone || "";
  const payeeEmail = settlement.vendors?.email ?? null;
  const payeeAddress = settlement.vendors?.address ?? null;
  const payeePan = settlement.vendors?.pan_vat_no ?? null;

  const items: SettlementDetailItem[] = settlement.settlement_items.map((si) => {
    const parcel = si.cod_collections.parcels;
    return {
      orderNumber: parcel.order_number,
      trackingId: parcel.tracking_id,
      reference: null,
      receiverName: parcel.parties_parcels_receiver_idToparties.name,
      receiverPhone: parcel.parties_parcels_receiver_idToparties.phone,
      destination: formatLocation(parcel.locations_parcels_destination_location_idTolocations),
      orderType: parcel.order_type,
      pieces: parcel.pieces,
      weightKg: parcel.weight_kg === null ? null : Number(parcel.weight_kg),
      codAmount: Number(si.cod_collections.cod_amount),
      collectedAmount: Number(si.cod_collections.collected_amount),
      deliveryCharge: Number(parcel.delivery_charge),
      settledAmount: Number(si.amount),
      deliveredAt: parcel.delivered_at ? parcel.delivered_at.toISOString() : null,
    };
  });

  return {
    id: settlement.id,
    statementId: settlement.statement_id,
    payeeType: settlement.payee_type as "rider" | "vendor",
    payeeName,
    payeePhone,
    payeeEmail,
    payeeAddress,
    payeePan,
    transferDate: settlement.settlement_date ? formatNepalDate(settlement.settlement_date) : null,
    createdAt: settlement.created_at.toISOString(),
    amount: Number(settlement.amount),
    payableAmount: Number(settlement.payable_amount ?? settlement.amount),
    status: settlement.status,
    paymentMethod: settlement.payment_method,
    payments: Array.isArray(settlement.payments)
      ? (settlement.payments as unknown as SettlementPaymentInput[])
      : [],
    remark: settlement.remark,
    items,
  };
}
