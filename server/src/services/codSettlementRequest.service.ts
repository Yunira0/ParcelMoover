// Vendor COD settlement requests.
//
// This used to be a support ticket with category "cod_settlement". Two things
// were wrong with that and both are fixed here:
//
//   1. Nothing stopped a vendor opening ten requests for the same money. The
//      rule now is one live request at a time, enforced by a partial unique
//      index rather than by a check in this file - see createCodSettlementRequest.
//   2. The payout bank details were composed into a ticket's free-text
//      description, so nothing could query or validate them. They are columns now.
//
// What this is NOT is a settlement. This is the vendor's *ask*. The money
// actually moving is a `settlements` row, created by an admin through the
// existing settlement flow; a settled request just points at it.
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getDatePart, randomBase32 } from "../utils/trackingId";
import { getVendorAccountBalance } from "./billing.service";
import { createNotification } from "./notification.service";
import { notifyAdmins } from "./order.service";
import {
  CreateCodSettlementRequestInput,
  ListCodSettlementRequestsParams,
  LIVE_REQUEST_STATUSES,
  UpdateCodSettlementRequestStatusInput,
} from "../types/codSettlementRequest.type";

type Actor = { id: string; roles: string[] };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

const isStaff = (actor: Actor) => actor.roles.includes("admin") || actor.roles.includes("super_admin");

function generateRequestNo(date = new Date()) {
  return `CSR-${getDatePart(date)}-${randomBase32(6)}`;
}

/**
 * The vendor this actor acts for, as owner first and then as staff.
 *
 * The vendor portal is a shared workspace, so a request raised by staff belongs
 * to the vendor org, not to the individual - which is also what makes the
 * one-live-request rule meaningful. Scoping it per user would let a vendor with
 * three staff accounts raise three simultaneous requests.
 */
async function resolveActorVendorId(actor: Actor): Promise<string | null> {
  const asOwner = await prisma.vendors.findFirst({
    where: { user_id: actor.id, deleted_at: null },
    select: { id: true },
  });
  if (asOwner) return asOwner.id;

  const asStaff = await prisma.vendor_staff.findFirst({
    where: { user_id: actor.id, deleted_at: null },
    select: { vendor_id: true },
  });
  return asStaff?.vendor_id ?? null;
}

const REQUEST_INCLUDE = {
  vendors: { select: { id: true, client_name: true, business_name: true, phone: true } },
  reviewed_by_user: { select: { full_name: true } },
  settlements: { select: { id: true, statement_id: true, status: true } },
} as const;

type RequestRow = {
  id: string;
  request_no: string;
  vendor_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  note: string | null;
  amount_snapshot: unknown;
  status: string;
  decision_note: string | null;
  reviewed_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  vendors?: { client_name: string; business_name: string | null } | null;
  reviewed_by_user?: { full_name: string } | null;
  settlements?: { id: string; statement_id: string; status: string } | null;
};

function mapRequest(row: RequestRow) {
  return {
    id: row.id,
    requestNo: row.request_no,
    vendorId: row.vendor_id,
    vendorName: row.vendors?.business_name || row.vendors?.client_name || "",
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountName: row.account_name,
    note: row.note || "",
    amountSnapshot: row.amount_snapshot === null ? null : Number(row.amount_snapshot),
    status: row.status,
    decisionNote: row.decision_note || "",
    reviewedBy: row.reviewed_by_user?.full_name || "",
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    settlementId: row.settlements?.id ?? null,
    settlementStatementId: row.settlements?.statement_id ?? null,
    settlementStatus: row.settlements?.status ?? null,
  };
}

/**
 * The vendor's live request, if they have one.
 *
 * Exposed because the vendor UI needs it before the user fills anything in -
 * showing the existing request beats letting them type out a form only to be
 * refused on submit.
 */
export async function getLiveRequestForVendor(vendorId: string) {
  const row = await prisma.cod_settlement_requests.findFirst({
    where: { vendor_id: vendorId, status: { in: LIVE_REQUEST_STATUSES } },
    include: REQUEST_INCLUDE,
    orderBy: { created_at: "desc" },
  });
  return row ? mapRequest(row) : null;
}

/**
 * The bank account this vendor registered with, to prefill the request form.
 *
 * Read-only and deliberately separate from the request itself: a payout may go
 * somewhere else, so the vendor edits these before submitting and what they
 * send is what gets stored. Nothing here writes back to the vendor record.
 */
export async function getRegisteredBankDetails(actor: Actor) {
  const vendorId = await resolveActorVendorId(actor);
  if (!vendorId) throw new AppError(403, "Only a vendor account has registered bank details");

  const vendor = await prisma.vendors.findUnique({
    where: { id: vendorId },
    select: { bank_name: true, bank_account_no: true, bank_account_holder: true },
  });
  if (!vendor) throw new AppError(404, "Vendor not found");

  // Bank fields are optional at registration, so empty strings (not an error)
  // are the honest answer for a vendor who never supplied them.
  return {
    bankName: vendor.bank_name ?? "",
    accountNumber: vendor.bank_account_no ?? "",
    accountName: vendor.bank_account_holder ?? "",
  };
}

export async function createCodSettlementRequest(actor: Actor, input: CreateCodSettlementRequestInput) {
  const vendorId = await resolveActorVendorId(actor);
  if (!vendorId) throw new AppError(403, "Only a vendor account can request a COD settlement");

  // Checked here so the vendor gets a sentence rather than a constraint name.
  // This is NOT what enforces the rule - see the catch below.
  const live = await getLiveRequestForVendor(vendorId);
  if (live) {
    throw new AppError(
      409,
      `You already have a COD settlement request (${live.requestNo}) awaiting settlement. ` +
        `You can raise another once this one is settled or rejected.`,
    );
  }

  // Context for whoever reviews it. Best-effort: a request is still worth
  // raising if the balance service is briefly unavailable, so a failure here
  // must not cost the vendor their request.
  let amountSnapshot: number | null = null;
  try {
    amountSnapshot = (await getVendorAccountBalance(vendorId)).balance;
  } catch (error) {
    console.error("[CodSettlementRequest] Could not snapshot the vendor balance:", error);
  }

  let created;
  try {
    created = await prisma.cod_settlement_requests.create({
      data: {
        request_no: generateRequestNo(),
        vendor_id: vendorId,
        bank_name: input.bankName.trim(),
        account_number: input.accountNumber.trim(),
        account_name: input.accountName.trim(),
        note: input.note?.trim() || null,
        ...(amountSnapshot !== null ? { amount_snapshot: amountSnapshot } : {}),
        status: "open",
        created_by: actor.id,
      },
      include: REQUEST_INCLUDE,
    });
  } catch (error: unknown) {
    // Two submissions landing together both pass the check above; the database
    // is what actually decides. P2002 here can only be the one-live-per-vendor
    // index (request_no collisions are astronomically unlikely and would be a
    // different column), so it means the same thing as the check.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new AppError(409, "You already have a COD settlement request awaiting settlement.");
    }
    throw error;
  }

  await notifyAdmins(
    `New COD Settlement Request: ${created.request_no}`,
    `${mapRequest(created).vendorName} has requested a COD settlement`,
    created.id,
    "cod_settlement",
    `/cod-settlement-requests/${created.id}`,
  );

  return mapRequest(created);
}

export async function listCodSettlementRequests(actor: Actor, params: ListCodSettlementRequestsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;

  if (!isStaff(actor)) {
    const vendorId = await resolveActorVendorId(actor);
    // Not linked to a vendor - show nothing rather than everything.
    if (!vendorId) return { data: [], meta: { page, pageSize, total: 0, totalPages: 0 } };
    where.vendor_id = vendorId;
  }

  if (params.search?.trim()) {
    const search = params.search.trim();
    where.OR = [
      { request_no: { contains: search, mode: "insensitive" } },
      { account_name: { contains: search, mode: "insensitive" } },
      { vendors: { client_name: { contains: search, mode: "insensitive" } } },
      { vendors: { business_name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.cod_settlement_requests.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { created_at: params.sortDir === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cod_settlement_requests.count({ where }),
  ]);

  return {
    data: rows.map(mapRequest),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getCodSettlementRequestById(actor: Actor, id: string) {
  const row = await prisma.cod_settlement_requests.findUnique({ where: { id }, include: REQUEST_INCLUDE });
  if (!row) throw new AppError(404, "COD settlement request not found");

  if (!isStaff(actor)) {
    const vendorId = await resolveActorVendorId(actor);
    if (!vendorId || row.vendor_id !== vendorId) {
      throw new AppError(404, "COD settlement request not found");
    }
  }

  return mapRequest(row);
}

/**
 * Moves a request through its lifecycle. Staff only.
 *
 * A terminal request never reopens: settling or rejecting stamps closed_at and
 * releases the vendor's hold, and letting an admin flip that back would either
 * strand a vendor who has already raised their next request, or silently
 * un-settle a payout that really happened.
 */
export async function updateCodSettlementRequestStatus(
  actor: Actor,
  id: string,
  input: UpdateCodSettlementRequestStatusInput,
) {
  if (!isStaff(actor)) throw new AppError(403, "Only staff can action a COD settlement request");

  const existing = await prisma.cod_settlement_requests.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "COD settlement request not found");

  if (!LIVE_REQUEST_STATUSES.includes(existing.status as never)) {
    throw new AppError(409, `This request is already ${existing.status} and cannot be changed`);
  }

  if (input.status === "rejected" && !input.decisionNote?.trim()) {
    // The vendor is blocked from re-raising until this closes, so "no" without
    // a reason leaves them with nothing to act on.
    throw new AppError(400, "A reason is required when rejecting a COD settlement request");
  }

  const isTerminal = input.status === "settled" || input.status === "rejected";

  const updated = await prisma.cod_settlement_requests.update({
    where: { id },
    data: {
      status: input.status,
      decision_note: input.decisionNote?.trim() || null,
      ...(input.settlementId ? { settlement_id: input.settlementId } : {}),
      reviewed_by: actor.id,
      reviewed_at: new Date(),
      ...(isTerminal ? { closed_at: new Date() } : {}),
    },
    include: REQUEST_INCLUDE,
  });

  // Tell the vendor who raised it. Only on a terminal move: "an admin opened
  // your request" is not news, but "you have been paid" and "we said no,
  // here is why" both are - and the second is what tells them they may re-raise.
  if (isTerminal && existing.created_by) {
    const settled = input.status === "settled";
    await createNotification(
      existing.created_by,
      settled
        ? `COD settlement request ${updated.request_no} settled`
        : `COD settlement request ${updated.request_no} rejected`,
      settled ? "Your COD settlement has been processed." : updated.decision_note || "No reason given.",
      updated.id,
      "cod_settlement",
      `/vendor/cod-settlement-requests`,
    );
  }

  return mapRequest(updated);
}
