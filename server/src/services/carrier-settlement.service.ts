// 3PL carrier COD statements (NCM, Upaya).
//
// A carrier collects COD on the parcels it delivers and later pays it to us,
// keeping a per-order delivery charge. A statement bundles delivered orders a
// carrier collected COD on, each with its charge; creating it only earmarks
// the orders, and money lands through instalments until nothing is owed -
// the same lifecycle as a branch COD statement (see branch.service.ts).

import crypto from "crypto";
import { Prisma, parcel_status, payment_status } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { assertHeadOfficeOnly } from "../lib/branchScope";
import { AppError } from "../utils/AppError";
import { syncCarrierSettlementPostings } from "./accounting/sync";
import { CARRIER_CODES, type CarrierCode, isCarrierCode } from "./orders/carrier";
import { getActivePaymentMethodNames } from "./payment-method.service";
import { nepalDayRangeUtc } from "../utils/nepalTime";

type Actor = { id: string; roles: string[] };
type PaymentLine = { method: string; amount: number };

const HEAD_OFFICE_ONLY = "3PL COD is settled centrally from Imadol, not from a branch";
const DELIVERED: parcel_status[] = [parcel_status.delivered, parcel_status.partially_delivered];
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const money = (value: Prisma.Decimal | number | string | null | undefined) => Number(value ?? 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

function assertCarrier(carrier: unknown): CarrierCode {
  if (!isCarrierCode(carrier)) throw new AppError(400, `carrier must be one of: ${CARRIER_CODES.join(", ")}`);
  return carrier;
}

function paymentLines(value: Prisma.JsonValue | null): PaymentLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return [];
    const method = "method" in line && typeof line.method === "string" ? line.method : "";
    const amount = "amount" in line ? Number(line.amount) : Number.NaN;
    return method && Number.isFinite(amount) ? [{ method, amount }] : [];
  });
}

function sumByMethod(lines: PaymentLine[]): PaymentLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.method, round2((totals.get(line.method) ?? 0) + line.amount));
  return Array.from(totals, ([method, amount]) => ({ method, amount }));
}

// Delivered by this carrier, cash collected, not yet settled or earmarked.
const unsettledWhere = (carrier: CarrierCode): Prisma.cod_collectionsWhereInput => ({
  carrier_code: carrier,
  carrier_payment_status: payment_status.pending,
  collected_at: { not: null },
  collected_amount: { gt: 0 },
  carrier_settlement_item: { is: null },
  parcels: { deleted_at: null, status: { in: DELIVERED } },
});

// ── Orders to settle ────────────────────────────────────────────────────────

export async function getUnsettledCarrierOrders(actor: Actor, carrierParam: unknown) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const carrier = assertCarrier(carrierParam);
  const rows = await prisma.cod_collections.findMany({
    where: unsettledWhere(carrier),
    select: {
      id: true,
      collected_amount: true,
      parcels: {
        select: {
          order_number: true,
          tracking_id: true,
          delivered_at: true,
          vendors: { select: { business_name: true, client_name: true } },
          parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
          locations_parcels_destination_location_idTolocations: { select: { name: true } },
        },
      },
    },
    orderBy: { collected_at: "asc" },
  });
  return rows.map((row) => ({
    codCollectionId: row.id,
    orderNumber: row.parcels.order_number,
    trackingId: row.parcels.tracking_id,
    vendorName: row.parcels.vendors?.business_name || row.parcels.vendors?.client_name || "",
    receiverName: row.parcels.parties_parcels_receiver_idToparties.name,
    receiverPhone: row.parcels.parties_parcels_receiver_idToparties.phone,
    destination: row.parcels.locations_parcels_destination_location_idTolocations?.name ?? null,
    deliveredAt: row.parcels.delivered_at?.toISOString() ?? null,
    collectedAmount: money(row.collected_amount),
  }));
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateCarrierSettlementInput {
  carrier: string;
  settlementDate: string;
  items: Array<{ codCollectionId: string; carrierCharge: number }>;
  remark?: string;
}

export async function createCarrierSettlement(actor: Actor, input: CreateCarrierSettlementInput) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const carrier = assertCarrier(input.carrier);
  const charges = new Map(input.items.map((item) => [item.codCollectionId, round2(item.carrierCharge)]));
  if (charges.size === 0) throw new AppError(400, "Select at least one order");

  const run = () => prisma.$transaction(async (tx) => {
    const collections = await tx.cod_collections.findMany({
      where: { ...unsettledWhere(carrier), id: { in: [...charges.keys()] } },
      select: { id: true, collected_amount: true },
    });
    if (collections.length !== charges.size) {
      throw new AppError(409, `Some selected orders were not delivered by ${carrier.toUpperCase()} or are already settled or on a statement`);
    }

    const items = collections.map((c) => {
      const collected = money(c.collected_amount);
      const charge = charges.get(c.id)!;
      if (!(charge >= 0 && charge <= collected)) {
        throw new AppError(400, "Each carrier charge must be between 0 and the COD collected on that order");
      }
      return { cod_collection_id: c.id, collected_amount: collected, carrier_charge: charge, net_amount: round2(collected - charge) };
    });
    const gross = round2(items.reduce((sum, i) => sum + i.collected_amount, 0));
    const chargeTotal = round2(items.reduce((sum, i) => sum + i.carrier_charge, 0));
    const statementNo = `CRS-${input.settlementDate.replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const settlement = await tx.carrier_settlements.create({
      data: {
        statement_no: statementNo,
        carrier_code: carrier,
        settlement_date: new Date(`${input.settlementDate}T00:00:00.000Z`),
        gross_cod: gross,
        carrier_charges: chargeTotal,
        net_receivable: round2(gross - chargeTotal),
        remark: input.remark?.trim() || null,
        created_by: actor.id,
        items: { create: items },
      },
    });
    await tx.audit_logs.create({ data: {
      actor_id: actor.id,
      entity_type: "carrier_settlement",
      entity_id: settlement.id,
      action: "CREATE_CARRIER_SETTLEMENT",
      new_data: { statementNo, carrier, orders: items.length, grossCod: gross, carrierCharges: chargeTotal },
    } });
    await syncCarrierSettlementPostings(tx, [settlement.id], { actorId: actor.id, reason: "carrier statement created" });
    return settlement;
  }, TX_OPTIONS);

  try {
    const settlement = await run();
    return { id: settlement.id, statementNo: settlement.statement_no };
  } catch (error) {
    // A concurrent statement can claim an order between the check and the
    // insert; the unique item row turns that into P2002.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "Some selected orders were just added to another statement. Refresh and try again.");
    }
    throw error;
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function listCarrierSettlements(
  actor: Actor,
  query: { carrier?: string; status?: string; settledFrom?: string; settledTo?: string; page?: number; pageSize?: number },
) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const page = Math.max(1, query.page || 1);
  const where: Prisma.carrier_settlementsWhereInput = {
    ...(query.carrier ? { carrier_code: assertCarrier(query.carrier) } : {}),
    ...(query.status ? { status: query.status } : {}),
    // By when the statement was settled (Nepal-local days), not the date it was raised.
    ...(query.settledFrom || query.settledTo ? { settled_at: nepalDayRangeUtc(query.settledFrom, query.settledTo) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.carrier_settlements.count({ where }),
    prisma.carrier_settlements.findMany({
      where,
      orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    data: rows.map((s) => ({
      id: s.id,
      statementNo: s.statement_no,
      carrier: s.carrier_code,
      settlementDate: s.settlement_date.toISOString().slice(0, 10),
      status: s.status,
      netReceivable: money(s.net_receivable),
      paidAmount: money(s.paid_amount),
      paymentBreakdown: paymentLines(s.payments),
      settledAt: s.settled_at?.toISOString() ?? null,
      remark: s.remark,
    })),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getCarrierSettlementDetail(actor: Actor, id: string) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const s = await prisma.carrier_settlements.findUnique({
    where: { id },
    include: {
      payment_records: { orderBy: { paid_at: "asc" } },
      items: {
        orderBy: { created_at: "asc" },
        include: {
          cod_collection: {
            select: {
              parcels: {
                select: {
                  order_number: true,
                  tracking_id: true,
                  vendors: { select: { business_name: true, client_name: true } },
                  parties_parcels_receiver_idToparties: { select: { name: true } },
                  locations_parcels_destination_location_idTolocations: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!s) throw new AppError(404, "Carrier statement not found");

  const userIds = [s.created_by, s.settled_by, ...s.payment_records.map((p) => p.recorded_by)].filter((v): v is string => !!v);
  const users = await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } });
  const nameOf = (userId: string | null) => users.find((u) => u.id === userId)?.full_name ?? null;

  const netReceivable = money(s.net_receivable);
  const paidAmount = money(s.paid_amount);
  return {
    id: s.id,
    statementNo: s.statement_no,
    carrier: s.carrier_code,
    settlementDate: s.settlement_date.toISOString().slice(0, 10),
    status: s.status,
    grossCod: money(s.gross_cod),
    carrierCharges: money(s.carrier_charges),
    netReceivable,
    paidAmount,
    remainingAmount: round2(netReceivable - paidAmount),
    paymentBreakdown: paymentLines(s.payments),
    remark: s.remark,
    createdBy: nameOf(s.created_by),
    createdAt: s.created_at.toISOString(),
    settledAt: s.settled_at?.toISOString() ?? null,
    payments: s.payment_records.map((p) => ({
      id: p.id,
      amount: money(p.amount),
      method: p.method,
      breakdown: paymentLines(p.breakdown),
      remark: p.remark,
      proofPath: p.proof_path,
      paidAt: p.paid_at.toISOString(),
      recordedBy: nameOf(p.recorded_by),
    })),
    items: s.items.map((i) => {
      const parcel = i.cod_collection.parcels;
      return {
        codCollectionId: i.cod_collection_id,
        orderNumber: parcel.order_number,
        trackingId: parcel.tracking_id,
        vendorName: parcel.vendors?.business_name || parcel.vendors?.client_name || "",
        receiverName: parcel.parties_parcels_receiver_idToparties.name,
        destination: parcel.locations_parcels_destination_location_idTolocations?.name ?? null,
        collectedAmount: money(i.collected_amount),
        carrierCharge: money(i.carrier_charge),
        netAmount: money(i.net_amount),
      };
    }),
  };
}

// ── Pay / cancel ────────────────────────────────────────────────────────────

async function lockCarrierSettlement(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM carrier_settlements WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, "Carrier statement not found");
}

export interface PayCarrierSettlementInput {
  payments: PaymentLine[];
  remark?: string;
  proofPath?: string | null;
}

export async function payCarrierSettlement(actor: Actor, id: string, input: PayCarrierSettlementInput) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const activeMethods = new Set((await getActivePaymentMethodNames()).map((m) => m.toLowerCase()));
  for (const payment of input.payments) {
    if (!activeMethods.has(payment.method.trim().toLowerCase())) throw new AppError(400, `Unknown payment method "${payment.method}"`);
    if (!(payment.amount >= 0)) throw new AppError(400, "Payment amounts cannot be negative");
  }
  const total = round2(input.payments.reduce((sum, p) => sum + p.amount, 0));

  return prisma.$transaction(async (tx) => {
    await lockCarrierSettlement(tx, id);
    const s = await tx.carrier_settlements.findUniqueOrThrow({ where: { id } });
    if (s.status === "settled") throw new AppError(409, "This carrier statement is already settled");
    if (s.status === "cancelled") throw new AppError(409, "This carrier statement has been cancelled");

    const net = money(s.net_receivable);
    const outstanding = round2(net - money(s.paid_amount));
    if (total <= 0 && outstanding > 0) throw new AppError(400, "Payment amount must be greater than zero");
    if (total > outstanding) throw new AppError(400, `Payment total (Rs. ${total}) is more than the Rs. ${outstanding} outstanding`);

    const newPaid = round2(money(s.paid_amount) + total);
    const fullySettled = round2(net - newPaid) === 0;
    const lines = input.payments.map((p) => ({ method: p.method.trim(), amount: p.amount }));
    const allPayments = sumByMethod([...paymentLines(s.payments), ...lines]);

    const payment = await tx.carrier_settlement_payments.create({ data: {
      settlement_id: id,
      amount: total,
      method: Array.from(new Set(lines.map((l) => l.method))).join(", "),
      breakdown: lines as unknown as Prisma.InputJsonValue,
      remark: input.remark?.trim() || null,
      proof_path: input.proofPath ?? null,
      recorded_by: actor.id,
    } });
    const updated = await tx.carrier_settlements.update({
      where: { id },
      data: {
        paid_amount: newPaid,
        status: fullySettled ? "settled" : "partially_paid",
        payment_method: allPayments.map((l) => l.method).join(", "),
        payments: allPayments as unknown as Prisma.InputJsonValue,
        ...(fullySettled ? { settled_by: actor.id, settled_at: new Date() } : {}),
      },
    });

    // Only a statement paid in full clears its orders: a part payment can't be
    // pinned to particular orders (the dashboard counts it by paid share).
    if (fullySettled) {
      const items = await tx.carrier_settlement_items.findMany({ where: { settlement_id: id }, select: { cod_collection_id: true, collected_amount: true } });
      for (const item of items) {
        await tx.cod_collections.update({
          where: { id: item.cod_collection_id },
          data: { carrier_payment_status: payment_status.paid, carrier_remitted_amount: item.collected_amount, carrier_settled_at: new Date() },
        });
      }
    }

    await tx.audit_logs.create({ data: {
      actor_id: actor.id,
      entity_type: "carrier_settlement",
      entity_id: id,
      action: fullySettled ? "PAY_CARRIER_SETTLEMENT" : "PART_PAY_CARRIER_SETTLEMENT",
      new_data: { statementNo: s.statement_no, amount: total, paidAmount: newPaid, status: updated.status },
    } });
    await syncCarrierSettlementPostings(tx, [id], { actorId: actor.id, reason: "carrier statement paid" });
    return { id, status: updated.status, paidAmount: newPaid, remainingAmount: round2(net - newPaid), paymentId: payment.id };
  }, TX_OPTIONS);
}

export async function cancelCarrierSettlement(actor: Actor, id: string, remark: string) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  return prisma.$transaction(async (tx) => {
    await lockCarrierSettlement(tx, id);
    const s = await tx.carrier_settlements.findUniqueOrThrow({ where: { id }, include: { items: { select: { cod_collection_id: true } } } });
    if (s.status !== "pending" || money(s.paid_amount) > 0) {
      throw new AppError(409, "Only a statement with no payment recorded can be cancelled");
    }
    await tx.carrier_settlement_items.deleteMany({ where: { settlement_id: id } });
    const updated = await tx.carrier_settlements.update({ where: { id }, data: { status: "cancelled", remark: remark.trim() } });
    await tx.audit_logs.create({ data: {
      actor_id: actor.id,
      entity_type: "carrier_settlement",
      entity_id: id,
      action: "CANCEL_CARRIER_SETTLEMENT",
      old_data: { status: s.status, codCollectionIds: s.items.map((i) => i.cod_collection_id) },
      new_data: { status: "cancelled", remark: remark.trim() },
    } });
    await syncCarrierSettlementPostings(tx, [id], { actorId: actor.id, reason: "carrier statement cancelled" });
    return { id, statementNo: updated.statement_no, status: updated.status };
  }, TX_OPTIONS);
}
