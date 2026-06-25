import { Prisma } from "../generated/prisma/client";
import { payment_status } from "../generated/prisma/enums";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import {
  CodPaymentFilter,
  OrderCodItem,
  OrderCodListResult,
  PendingCodBill,
  PendingCodItem,
  SettlementListItem,
  SettlementsListResult,
  VendorBillingProfile,
} from "../types/finance.type";

type Actor = { id: string; roles: string[] };

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// Vendors only ever see their own finance records. Staff (admin/super_admin)
// must explicitly name a vendor - there is no "view everyone's COD" mode here,
// since this is financial data and an unscoped query would leak across vendors.
async function resolveVendor(actor: Actor, vendorIdParam?: string) {
  const isStaff = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  const isVendor = actor.roles.includes("vendor");

  if (isVendor) {
    const vendor = await prisma.vendors.findFirst({
      where: { user_id: actor.id, deleted_at: null, status: "active" },
    });
    if (!vendor) {
      throw new AppError(403, "Vendor profile not found or inactive");
    }
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

  const collections = await prisma.cod_collections.findMany({
    where: { vendor_id: vendor.id, payment_status: payment_status.pending },
    include: {
      parcels: {
        select: {
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
    trackingId: c.parcels.tracking_id,
    receiverName: c.parcels.parties_parcels_receiver_idToparties.name,
    receiverPhone: c.parcels.parties_parcels_receiver_idToparties.phone,
    destination: formatLocation(c.parcels.locations_parcels_destination_location_idTolocations),
    codAmount: Number(c.cod_amount),
    deliveryCharge: Number(c.parcels.delivery_charge),
  }));

  const totalCod = items.reduce((sum, item) => sum + item.codAmount, 0);
  const deliveryCharges = items.reduce((sum, item) => sum + item.deliveryCharge, 0);

  return {
    vendor: toBillingProfile(vendor),
    statementDate: new Date().toISOString(),
    items,
    totals: {
      totalCod,
      deliveryCharges,
      payableAmount: totalCod - deliveryCharges,
    },
  };
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

  const statusFilter =
    status === "settled" ? payment_status.paid : status === "not_settled" ? payment_status.pending : undefined;

  const where: Prisma.cod_collectionsWhereInput = {
    vendor_id: vendor.id,
    ...(statusFilter ? { payment_status: statusFilter } : {}),
  };

  const [settledCount, notSettledCount, total, collections] = await Promise.all([
    prisma.cod_collections.count({ where: { vendor_id: vendor.id, payment_status: payment_status.paid } }),
    prisma.cod_collections.count({ where: { vendor_id: vendor.id, payment_status: payment_status.pending } }),
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
    netPayable: Number(c.cod_amount) - Number(c.parcels.delivery_charge),
  }));

  return {
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
}

export async function listSettlements(
  actor: Actor,
  vendorIdParam: string | undefined,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  fromDate?: Date,
  toDate?: Date,
): Promise<SettlementsListResult> {
  const vendor = await resolveVendor(actor, vendorIdParam);

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * take;

  const where: Prisma.settlementsWhereInput = {
    vendor_id: vendor.id,
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
      include: { settlement_items: { select: { cod_collection_id: true } } },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
  ]);

  const data: SettlementListItem[] = settlements.map((s) => ({
    id: s.id,
    statementId: s.statement_id,
    transferDate: s.settlement_date ? s.settlement_date.toISOString().slice(0, 10) : null,
    orderCount: s.settlement_items.length,
    amount: Number(s.payable_amount ?? s.amount),
    status: s.status,
    remark: s.remark,
  }));

  return {
    data,
    meta: {
      page: safePage,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
}
