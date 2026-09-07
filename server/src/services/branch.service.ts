import { Prisma, parcel_status } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { listOrders, type OrderActor } from "./order.service";
import { invalidateDestinationPricingCache } from "./pricing.service";
import type {
  BranchSettlementQuery,
  BranchTrackingQuery,
  CreateBranchInput,
  CreateBranchSettlementInput,
  PayBranchSettlementInput,
} from "../validators/branch.schema";
import { getActivePaymentMethodNames } from "./payment-method.service";
import { createNotification } from "./notification.service";
import { evaluateBranchBilling } from "./branch-billing.service";

const DELIVERED: parcel_status[] = ["delivered", "partially_delivered"];
const METRIC_STATUSES: Record<string, parcel_status[] | undefined> = {
  totalOrders: undefined,
  inTransit: ["dispatched", "oov"],
  pendingDelivery: ["arrived_at_branch", "ready_to_deliver", "sent_for_delivery", "failed_delivery"],
  totalDelivered: DELIVERED,
  returnProcessing: ["follow_up", "ready_to_return", "sent_to_vendor"],
  returned: ["returned_to_vendor"],
  hold: ["hold"],
  failed: ["failed_pickup", "failed_delivery", "loss_and_damage"],
  deposited: DELIVERED,
  pendingDeposit: DELIVERED,
};

const money = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

function dayRange(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
  // Nepal is UTC+05:45. Translate local date boundaries to UTC explicitly so
  // server deployment timezone cannot change branch reports.
  const offsetMs = 5.75 * 60 * 60 * 1000;
  const range: Prisma.DateTimeFilter = {};
  if (dateFrom) range.gte = new Date(new Date(`${dateFrom}T00:00:00.000Z`).getTime() - offsetMs);
  if (dateTo) {
    const start = new Date(`${dateTo}T00:00:00.000Z`).getTime() - offsetMs;
    range.lt = new Date(start + 24 * 60 * 60 * 1000);
  }
  return range.gte || range.lt ? range : undefined;
}

export async function canReadBranchTracking(actor: OrderActor) {
  if (actor.roles.includes("super_admin")) return true;
  const admin = await prisma.admins.findUnique({ where: { user_id: actor.id }, select: { permissions: true } });
  return Boolean(admin?.permissions.some((p) => p === "BRANCH_TRACKING_READ" || p === "BRANCH_TRACKING_WRITE"));
}

export async function canWriteBranchTracking(actor: OrderActor) {
  if (actor.roles.includes("super_admin")) return true;
  const admin = await prisma.admins.findUnique({ where: { user_id: actor.id }, select: { permissions: true } });
  return Boolean(admin?.permissions.includes("BRANCH_TRACKING_WRITE"));
}

export async function getActorBranchScope(actor: OrderActor) {
  const admin = await prisma.admins.findUnique({
    where: { user_id: actor.id }, select: { location_id: true, branch_scoped: true, permissions: true },
  });
  return {
    locationId: admin?.location_id ?? null,
    branchScoped: admin?.branch_scoped ?? false,
    canRead: actor.roles.includes("super_admin") || Boolean(admin?.permissions.some((p) => p === "BRANCH_TRACKING_READ" || p === "BRANCH_TRACKING_WRITE")),
    canWrite: actor.roles.includes("super_admin") || Boolean(admin?.permissions.includes("BRANCH_TRACKING_WRITE")),
  };
}

export async function listBranchesForTracking() {
  const branches = await prisma.locations.findMany({
    where: { parent_id: null, is_hub: true },
    select: {
      id: true, name: true, code: true, district: true, is_active: true,
      commission_per_parcel: true, _count: { select: { other_locations: true } },
    },
    orderBy: { name: "asc" },
  });
  return branches.map((b) => ({
    id: b.id, name: b.name.split(" - ")[0], code: b.code, district: b.district,
    isActive: b.is_active, commissionPerParcel: money(b.commission_per_parcel),
    coveredAreaCount: b._count.other_locations,
  }));
}

export async function resolveBranchLocationIds(branchId?: string) {
  if (!branchId) return undefined;
  const branch = await prisma.locations.findFirst({
    where: { id: branchId, parent_id: null, is_hub: true, is_active: true },
    select: {
      id: true,
      other_locations: { where: { is_active: true }, select: { id: true } },
      // Other branches this one virtually covers - each contributes its own
      // id plus its own plain covered areas. Deliberately one level only: a
      // virtual branch's OWN virtual list is not chased, so there is no cycle
      // to guard against and "covers" never becomes "covers what it covers".
      branch_virtual_coverage_branch: {
        select: {
          covered_branch: {
            select: { id: true, other_locations: { where: { is_active: true }, select: { id: true } } },
          },
        },
      },
    },
  });
  if (!branch) throw new AppError(404, "Branch not found or inactive");
  return [
    branch.id,
    ...branch.other_locations.map((a) => a.id),
    ...branch.branch_virtual_coverage_branch.flatMap((v) => [
      v.covered_branch.id,
      ...v.covered_branch.other_locations.map((a) => a.id),
    ]),
  ];
}

async function branchWhere(query: BranchTrackingQuery): Promise<Prisma.parcelsWhereInput> {
  const [originIds, destinationIds] = await Promise.all([
    resolveBranchLocationIds(query.fromBranchId), resolveBranchLocationIds(query.toBranchId),
  ]);
  const createdAt = dayRange(query.dateFrom, query.dateTo);
  return {
    deleted_at: null,
    ...(originIds ? { origin_location_id: { in: originIds } } : {}),
    ...(destinationIds ? { destination_location_id: { in: destinationIds } } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

async function metric(where: Prisma.parcelsWhereInput, statuses?: parcel_status[], settlement?: "settled" | "pending") {
  const scoped: Prisma.parcelsWhereInput = {
    AND: [where, ...(statuses ? [{ status: { in: statuses } }] : []),
      ...(settlement === "settled" ? [{ branch_settlement_items: { some: { settlement: { status: "settled" } } } }] : []),
      ...(settlement === "pending" ? [{ branch_settlement_items: { none: { settlement: { status: "settled" } } } }] : [])],
  };
  const aggregate = await prisma.parcels.aggregate({ where: scoped, _count: { _all: true }, _sum: { cod_amount: true } });
  if (settlement === "settled") {
    const settled = await prisma.branch_settlement_items.aggregate({
      where: { parcel: scoped, settlement: { status: "settled" } }, _sum: { collected_amount: true },
    });
    return { count: aggregate._count._all, amount: money(settled._sum.collected_amount) };
  }
  if (statuses === DELIVERED) {
    const delivered = await prisma.cod_collections.aggregate({
      where: { parcels: scoped }, _sum: { collected_amount: true },
    });
    return { count: aggregate._count._all, amount: money(delivered._sum.collected_amount) };
  }
  return { count: aggregate._count._all, amount: money(aggregate._sum.cod_amount) };
}

export async function getBranchOverview(query: BranchTrackingQuery) {
  const where = await branchWhere(query);
  const entries = await Promise.all(Object.entries(METRIC_STATUSES).map(async ([key, statuses]) => [
    key,
    await metric(where, statuses, key === "deposited" ? "settled" : key === "pendingDeposit" ? "pending" : undefined),
  ]));
  return Object.fromEntries(entries);
}

async function orderQuery(query: BranchTrackingQuery) {
  const [originLocationIds, destinationLocationIds] = await Promise.all([
    resolveBranchLocationIds(query.fromBranchId), resolveBranchLocationIds(query.toBranchId),
  ]);
  const statuses = query.metric ? METRIC_STATUSES[query.metric] : undefined;
  return {
    ...(originLocationIds ? { originLocationIds } : {}),
    ...(destinationLocationIds ? { destinationLocationIds } : {}),
    ...(statuses ? { status: statuses } : {}),
    ...(query.metric === "deposited" ? { branchSettlement: "settled" as const } : {}),
    ...(query.metric === "pendingDeposit" ? { branchSettlement: "pending" as const } : {}),
    ...(query.availableForSettlement ? { branchSettlement: "unassigned" as const } : {}),
    ...(query.dateFrom || query.dateTo ? { dateField: "createdAt" as const } : {}),
    ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo ? { dateTo: query.dateTo } : {}),
  };
}

/**
 * Branch tracking reports are cross-branch and stay behind BRANCH_TRACKING_READ.
 * A branch workspace admin reaches this only to pick the orders for its own COD
 * statement, so it is pinned to its own branch as the collecting (destination)
 * side and any caller-supplied route filter is dropped.
 */
async function scopeBranchOrderQuery(actor: OrderActor, query: BranchTrackingQuery): Promise<BranchTrackingQuery> {
  if (actor.roles.includes("super_admin")) return query;
  const scope = await getActorBranchScope(actor);
  if (scope.branchScoped) {
    if (!scope.locationId) throw new AppError(403, "Your branch account is not assigned to a branch");
    return { ...query, toBranchId: scope.locationId, fromBranchId: undefined };
  }
  if (!scope.canRead) throw new AppError(403, "Not authorized to view branch orders");
  return query;
}

export async function listBranchOrders(actor: OrderActor, query: BranchTrackingQuery) {
  const scoped = await scopeBranchOrderQuery(actor, query);
  return listOrders(actor, { ...(await orderQuery(scoped)),
    ...(scoped.page !== undefined ? { page: scoped.page } : {}),
    ...(scoped.pageSize !== undefined ? { pageSize: scoped.pageSize } : {}),
    ...(scoped.cursor ? { cursor: scoped.cursor } : {}),
    ...(scoped.dir ? { dir: scoped.dir } : {}),
  });
}

export async function exportBranchOrders(actor: OrderActor, query: BranchTrackingQuery) {
  const base = await orderQuery(query);
  const rows: Awaited<ReturnType<typeof listOrders>>["data"] = [];
  let cursor: string | undefined;
  let truncated = false;
  do {
    const page = await listOrders(actor, { ...base, pageSize: 100,
      ...(cursor ? { cursor } : {}), dir: "next", withArrival: true });
    rows.push(...page.data);
    if (rows.length >= 10_000) { truncated = Boolean(page.meta?.hasNextPage); break; }
    cursor = page.meta?.nextCursor ?? undefined;
  } while (cursor);
  return { data: rows.slice(0, 10_000), truncated };
}

export async function createOrPromoteBranch(actor: OrderActor, input: CreateBranchInput) {
  const areaIds = [...new Set(input.coveredAreaIds)].filter((id) => id !== input.locationId);
  const virtualBranchIds = [...new Set(input.virtualBranchIds ?? [])].filter((id) => id !== input.locationId);
  if (areaIds.some((id) => virtualBranchIds.includes(id))) {
    throw new AppError(400, "A location can't be both a covered destination and a virtual branch");
  }
  const result = await prisma.$transaction(async (tx) => {
    const locations = await tx.locations.findMany({
      where: { id: { in: [input.locationId, ...areaIds] } },
      select: { id: true, parent_id: true, name: true, is_hub: true, other_locations: { select: { id: true } } },
    });
    if (!locations.some((l) => l.id === input.locationId)) throw new AppError(404, "Branch location not found");
    if (locations.length !== areaIds.length + 1) throw new AppError(400, "One or more covered areas do not exist");
    const invalidArea = locations.find((l) => areaIds.includes(l.id) && l.other_locations.length > 0);
    if (invalidArea) throw new AppError(409, `${invalidArea.name} already has covered areas and cannot be nested`);
    // A covered area is a plain destination re-parented under the branch - an
    // existing branch is a different thing (see virtualBranchIds below) and
    // must never be demoted into one by landing in this list instead.
    const areaIsBranch = locations.find((l) => areaIds.includes(l.id) && l.is_hub);
    if (areaIsBranch) {
      throw new AppError(
        409,
        `${areaIsBranch.name} is already a branch - add it as a virtual branch instead of a covered destination`,
      );
    }

    // Virtual branches are re-checked here rather than trusted from the
    // client: each id must already be an existing, active branch (is_hub) -
    // that's what keeps this a side relationship instead of a re-parenting,
    // since only a branch's own row can be listed, never re-created as one.
    let virtualBranches: { id: string; name: string }[] = [];
    if (virtualBranchIds.length) {
      virtualBranches = await tx.locations.findMany({
        where: { id: { in: virtualBranchIds }, parent_id: null, is_hub: true, is_active: true },
        select: { id: true, name: true },
      });
      if (virtualBranches.length !== virtualBranchIds.length) {
        throw new AppError(400, "One or more virtual branches are not existing, active branches");
      }
    }

    const branch = await tx.locations.update({
      where: { id: input.locationId },
      data: { parent_id: null, is_hub: true, commission_per_parcel: input.commissionPerParcel },
    });
    if (areaIds.length) await tx.locations.updateMany({
      where: { id: { in: areaIds } }, data: { parent_id: branch.id, is_hub: false },
    });
    if (virtualBranchIds.length) {
      await tx.branch_virtual_coverage.createMany({
        data: virtualBranchIds.map((covered_branch_id) => ({
          branch_id: branch.id, covered_branch_id, created_by: actor.id,
        })),
        skipDuplicates: true,
      });
    }
    await tx.audit_logs.create({ data: {
      actor_id: actor.id, entity_type: "branch", entity_id: branch.id, action: "CREATE_OR_PROMOTE_BRANCH",
      new_data: {
        coveredAreaIds: areaIds, commissionPerParcel: input.commissionPerParcel,
        virtualBranches: virtualBranches.map((b) => b.name),
      },
    } });
    return branch;
  });
  await invalidateDestinationPricingCache();
  return { id: result.id, name: result.name, commissionPerParcel: money(result.commission_per_parcel) };
}

export async function listBranchSettlements(actor: OrderActor, query: BranchSettlementQuery) {
  const ownScope = actor.roles.includes("super_admin") ? null : await getActorBranchScope(actor);
  if (!actor.roles.includes("super_admin") && !ownScope?.locationId) {
    throw new AppError(403, "Your admin account is not assigned to a branch");
  }
  const ownBranchId = ownScope?.locationId;
  // Branch workspace: this branch is the payer. Head-office workspace: its
  // assigned master branch is the receiver. The default follows the actor's
  // side of the payer -> master workflow.
  const effectiveScope = query.scope ?? (ownScope?.branchScoped ? "outgoing" : "incoming");
  const ownRouteScope: Prisma.branch_settlementsWhereInput = actor.roles.includes("super_admin") ? {} : {
    ...(effectiveScope === "incoming" ? { to_branch_id: ownBranchId! }
      : effectiveScope === "all" ? { OR: [{ from_branch_id: ownBranchId! }, { to_branch_id: ownBranchId! }] }
      : { from_branch_id: ownBranchId! }),
  };
  const baseWhere: Prisma.branch_settlementsWhereInput = {
    ...(actor.roles.includes("super_admin") && query.fromBranchId ? { from_branch_id: query.fromBranchId } : {}),
    ...ownRouteScope,
    ...(actor.roles.includes("super_admin") && query.toBranchId ? { to_branch_id: query.toBranchId } : {}),
    ...(query.dateFrom || query.dateTo ? { settlement_date: {
      ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
      ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
    } } : {}),
  };
  const where: Prisma.branch_settlementsWhereInput = {
    ...baseWhere,
    ...(query.status ? { status: query.status } : {}),
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows, totals, pendingStatements] = await Promise.all([
    prisma.branch_settlements.count({ where }),
    prisma.branch_settlements.findMany({ where, skip, take: query.pageSize, orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      include: { from_branch: { select: { name: true } }, to_branch: { select: { name: true } }, _count: { select: { items: true } } } }),
    prisma.branch_settlements.aggregate({
      where: baseWhere,
      _sum: { gross_cod: true, commission_amount: true, net_payable: true, paid_amount: true },
    }),
    prisma.branch_settlements.count({ where: { ...baseWhere, status: { in: ["pending", "partially_paid"] } } }),
  ]);
  return { data: rows.map((s) => ({
    id: s.id, statementNo: s.statement_no, fromBranch: s.from_branch.name, toBranch: s.to_branch.name,
    settlementDate: s.settlement_date.toISOString().slice(0, 10), orderCount: s._count.items,
    grossCod: money(s.gross_cod), commissionAmount: money(s.commission_amount), netPayable: money(s.net_payable),
    commissionPerParcel: money(s.commission_per_parcel), status: s.status,
    paidAmount: money(s.paid_amount), remainingAmount: money(s.net_payable) - money(s.paid_amount),
    paymentMethod: s.payment_method, paymentBreakdown: paymentLines(s.payments), remark: s.remark,
  })),
  summary: {
    grossCod: money(totals._sum.gross_cod),
    commissionCredit: money(totals._sum.commission_amount),
    netPayable: money(totals._sum.net_payable),
    paid: money(totals._sum.paid_amount),
    outstanding: money(totals._sum.net_payable) - money(totals._sum.paid_amount),
    pendingStatements,
  },
  meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

async function assertCanCreateBranchSettlement(
  actor: OrderActor,
  masterBranchId: string,
  fromBranchId: string,
): Promise<void> {
  if (actor.roles.includes("super_admin")) return;
  const scope = await getActorBranchScope(actor);
  if (!scope.locationId) {
    throw new AppError(403, "Your admin account is not assigned to a branch");
  }
  // A branch workspace creates statements for its own COD only.
  if (scope.branchScoped) {
    if (scope.locationId !== fromBranchId) {
      throw new AppError(403, "You can only create a statement for your own branch");
    }
    return;
  }
  // A non-branch-scoped head-office admin must be the Imadol master-branch admin.
  if (scope.locationId !== masterBranchId) {
    throw new AppError(403, "Only an Imadol master-branch admin can create branch statements");
  }
}

async function getImadolMasterBranch() {
  const master = await prisma.locations.findFirst({
    where: {
      code: { equals: "IMADOL", mode: "insensitive" },
      parent_id: null,
      is_hub: true,
      is_active: true,
    },
    select: { id: true, name: true },
  });
  if (!master) throw new AppError(503, "The Imadol master branch is not configured or active");
  return master;
}

type BranchPaymentLine = { method: string; amount: number };

function paymentLines(value: Prisma.JsonValue | null): BranchPaymentLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return [];
    const method = "method" in line && typeof line.method === "string" ? line.method : "";
    const amount = "amount" in line ? Number(line.amount) : Number.NaN;
    return method && Number.isFinite(amount) ? [{ method, amount }] : [];
  });
}

function sumPaymentsByMethod(lines: BranchPaymentLine[]): BranchPaymentLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.method, Math.round(((totals.get(line.method) ?? 0) + line.amount) * 100) / 100);
  return Array.from(totals, ([method, amount]) => ({ method, amount }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function createBranchSettlement(actor: OrderActor, input: CreateBranchSettlementInput) {
  const masterBranch = await getImadolMasterBranch();
  if (input.toBranchId !== masterBranch.id) {
    throw new AppError(400, "The receiving master branch must be Imadol");
  }
  // A branch workspace can only ever settle its own COD, at its own agreed
  // commission rate - never trust either from that side of the request.
  const actorScope = actor.roles.includes("super_admin") ? null : await getActorBranchScope(actor);
  const isBranchCreator = Boolean(actorScope?.branchScoped && actorScope.locationId);
  const fromBranchId = isBranchCreator ? actorScope!.locationId! : input.fromBranchId;
  if (fromBranchId === masterBranch.id) {
    throw new AppError(400, "Imadol cannot create a COD statement to pay itself");
  }
  await assertCanCreateBranchSettlement(actor, masterBranch.id, fromBranchId);
  // The paying branch is where delivery happened and COD was collected. The
  // master branch receives that remittance; it is not a parcel-route filter.
  const [payingBranchLocationIds, fromBranch] = await Promise.all([
    resolveBranchLocationIds(fromBranchId),
    prisma.locations.findUnique({ where: { id: fromBranchId }, select: { commission_per_parcel: true } }),
  ]);
  const commissionPerParcel = isBranchCreator
    ? money(fromBranch?.commission_per_parcel)
    : (input.commissionPerParcel ?? money(fromBranch?.commission_per_parcel));
  const ids = [...new Set(input.orderIds)];
  const runInTransaction = () => prisma.$transaction(async (tx) => {
    const parcels = await tx.parcels.findMany({
      where: { id: { in: ids }, deleted_at: null, status: { in: DELIVERED },
        destination_location_id: { in: payingBranchLocationIds! },
        branch_settlement_items: { none: {} } },
      select: { id: true, cod_amount: true, cod_collections: { select: { collected_amount: true } } },
    });
    if (parcels.length !== ids.length) throw new AppError(409, "Some selected orders were not delivered by the paying branch or are already in a statement");
    const commission = new Prisma.Decimal(commissionPerParcel);
    const itemAmounts = parcels.map((p) => {
      const collected = p.cod_collections?.collected_amount ?? p.cod_amount;
      const net = Prisma.Decimal.max(new Prisma.Decimal(0), collected.minus(commission));
      return { parcelId: p.id, collected, commission: Prisma.Decimal.min(commission, collected), net };
    });
    const gross = itemAmounts.reduce((sum, i) => sum.plus(i.collected), new Prisma.Decimal(0));
    const commissionAmount = itemAmounts.reduce((sum, i) => sum.plus(i.commission), new Prisma.Decimal(0));
    const net = itemAmounts.reduce((sum, i) => sum.plus(i.net), new Prisma.Decimal(0));
    const stamp = input.settlementDate.replace(/-/g, "");
    const statementNo = `BRS-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const settlement = await tx.branch_settlements.create({ data: {
      statement_no: statementNo, from_branch_id: fromBranchId, to_branch_id: input.toBranchId,
      settlement_date: new Date(`${input.settlementDate}T00:00:00.000Z`), commission_per_parcel: commission,
      gross_cod: gross, commission_amount: commissionAmount, net_payable: net,
      status: "pending", remark: input.remark || null, created_by: actor.id,
      items: { create: itemAmounts.map((i) => ({ parcel_id: i.parcelId, collected_amount: i.collected,
        commission_amount: i.commission, net_payable: i.net })) },
    } });
    await tx.audit_logs.create({ data: { actor_id: actor.id, entity_type: "branch_settlement", entity_id: settlement.id,
      action: "CREATE_BRANCH_SETTLEMENT", new_data: { statementNo, orderIds: ids, netPayable: net.toString(), status: "pending" } } });
    return { id: settlement.id, statementNo, orderCount: ids.length, grossCod: money(gross),
      commissionAmount: money(commissionAmount), netPayable: money(net), paidAmount: 0,
      remainingAmount: money(net), status: settlement.status };
  });

  let result: Awaited<ReturnType<typeof runInTransaction>>;
  try {
    result = await runInTransaction();
  } catch (error) {
    // A concurrent statement can claim a parcel between the eligibility check
    // and the item insert; branch_settlement_items.parcel_id is unique, so the
    // loser trips P2002. Surface it as the same 409 the sequential path returns.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "Some selected orders were just added to another statement. Refresh and try again.");
    }
    throw error;
  }

  // Notify whichever side must act next. If Imadol cut the statement, the
  // paying branch owes the money; if the branch cut it, Imadol owes the
  // verification. Delivery is best-effort so it cannot roll back the record.
  try {
    const [recipients, title, body, link] = isBranchCreator
      ? [
          await prisma.admins.findMany({
            where: {
              location_id: masterBranch.id,
              users: { is: { status: "active", deleted_at: null } },
            },
            select: { user_id: true },
          }),
          `Branch statement ${result.statementNo} submitted`,
          `A branch created a Rs. ${result.netPayable.toLocaleString()} COD statement for ${result.orderCount} delivered order${result.orderCount === 1 ? "" : "s"}. Verify the payment once the branch remits it.`,
          "/branches/billing?tab=queue",
        ]
      : [
          await prisma.admins.findMany({
            where: {
              location_id: fromBranchId,
              branch_scoped: true,
              users: { is: { status: "active", deleted_at: null } },
            },
            select: { user_id: true },
          }),
          `Branch statement ${result.statementNo} created`,
          `Pay Rs. ${result.netPayable.toLocaleString()} to Imadol for ${result.orderCount} delivered order${result.orderCount === 1 ? "" : "s"}, then attach the payment proof.`,
          "/branches/billing?tab=statements",
        ];
    const userIds = [...new Set(recipients.map((recipient) => recipient.user_id))]
      .filter((userId) => userId !== actor.id);
    await Promise.all(userIds.map((userId) => createNotification(
      userId, title, body, result.id, "branch_settlement", link,
    )));
  } catch (error) {
    console.error("[Branch settlements] Failed to notify the next actor:", error);
  }

  // A new statement raises the branch's unsettled COD and can tip it into the
  // warn/block band. Refresh the stored alert state so reporting keyed on it
  // does not lag the live transit gate. Best-effort: it swallows its own errors.
  await evaluateBranchBilling(fromBranchId);

  return result;
}

export async function getBranchSettlementDetail(actor: OrderActor, settlementId: string) {
  const settlement = await prisma.branch_settlements.findUnique({
    where: { id: settlementId },
    include: {
      from_branch: { select: { id: true, name: true } },
      to_branch: { select: { id: true, name: true } },
      settled_by_user: { select: { full_name: true } },
      payment_records: {
        orderBy: { paid_at: "asc" },
        include: { recorded_by_user: { select: { full_name: true } } },
      },
      // A branch submits the receipt through Branch Payments, then office
      // verification creates the settlement payment above. Keep the verified
      // claims on the statement too so its proof can be reviewed later.
      payment_claims: {
        where: { status: "verified", proof_path: { not: null } },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          amount: true,
          method: true,
          reference: true,
          proof_path: true,
          note: true,
          reviewed_at: true,
          created_at: true,
        },
      },
      items: {
        orderBy: { created_at: "asc" },
        include: {
          parcel: {
            select: {
              order_number: true, tracking_id: true, status: true,
              parties_parcels_receiver_idToparties: { select: { name: true, phone: true } },
              locations_parcels_origin_location_idTolocations: { select: { name: true } },
              locations_parcels_destination_location_idTolocations: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!settlement) throw new AppError(404, "Branch settlement not found");
  if (!actor.roles.includes("super_admin")) {
    const scope = await getActorBranchScope(actor);
    if (!scope.canRead && (!scope.locationId || (settlement.from_branch_id !== scope.locationId && settlement.to_branch_id !== scope.locationId))) {
      throw new AppError(403, "You can only view settlements involving your assigned branch");
    }
  }

  const netPayable = money(settlement.net_payable);
  const paidAmount = money(settlement.paid_amount);
  return {
    id: settlement.id,
    statementNo: settlement.statement_no,
    fromBranch: { id: settlement.from_branch.id, name: settlement.from_branch.name },
    toBranch: { id: settlement.to_branch.id, name: settlement.to_branch.name },
    settlementDate: settlement.settlement_date.toISOString().slice(0, 10),
    status: settlement.status,
    grossCod: money(settlement.gross_cod),
    commissionPerParcel: money(settlement.commission_per_parcel),
    commissionAmount: money(settlement.commission_amount),
    netPayable,
    paidAmount,
    remainingAmount: round2(netPayable - paidAmount),
    paymentMethod: settlement.payment_method,
    paymentBreakdown: paymentLines(settlement.payments),
    remark: settlement.remark,
    settledAt: settlement.settled_at?.toISOString() ?? null,
    settledBy: settlement.settled_by_user?.full_name ?? null,
    createdAt: settlement.created_at.toISOString(),
    payments: settlement.payment_records.map((payment) => ({
      id: payment.id,
      amount: money(payment.amount),
      method: payment.method,
      breakdown: paymentLines(payment.breakdown),
      remark: payment.remark,
      paidAt: payment.paid_at.toISOString(),
      recordedBy: payment.recorded_by_user?.full_name ?? null,
    })),
    paymentProofs: settlement.payment_claims.map((claim) => ({
      id: claim.id,
      amount: money(claim.amount),
      method: claim.method,
      reference: claim.reference,
      proofPath: claim.proof_path!,
      note: claim.note,
      submittedAt: claim.created_at.toISOString(),
      verifiedAt: claim.reviewed_at?.toISOString() ?? null,
    })),
    items: settlement.items.map((item) => ({
      parcelId: item.parcel_id,
      orderNumber: item.parcel.order_number,
      trackingId: item.parcel.tracking_id,
      status: item.parcel.status,
      receiverName: item.parcel.parties_parcels_receiver_idToparties.name,
      receiverPhone: item.parcel.parties_parcels_receiver_idToparties.phone,
      origin: item.parcel.locations_parcels_origin_location_idTolocations?.name ?? null,
      destination: item.parcel.locations_parcels_destination_location_idTolocations?.name ?? null,
      collectedAmount: money(item.collected_amount),
      commissionAmount: money(item.commission_amount),
      netPayable: money(item.net_payable),
    })),
  };
}

async function lockBranchSettlement(tx: Prisma.TransactionClient, settlementId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM branch_settlements WHERE id = ${settlementId}::uuid FOR UPDATE`,
  );
  if (rows.length === 0) throw new AppError(404, "Branch settlement not found");
}

export async function payBranchSettlement(
  actor: OrderActor,
  settlementId: string,
  input: PayBranchSettlementInput,
) {
  if (!actor.roles.includes("super_admin")) {
    throw new AppError(403, "Only the office can record a settlement payment; branches must submit a receipt through Billing & Credit");
  }
  const activeMethods = new Set((await getActivePaymentMethodNames()).map((method) => method.toLowerCase()));
  for (const payment of input.payments) {
    if (!activeMethods.has(payment.method.trim().toLowerCase())) {
      throw new AppError(400, `Unknown payment method "${payment.method}"`);
    }
  }
  const paymentTotal = round2(input.payments.reduce((sum, payment) => sum + payment.amount, 0));

  const result = await prisma.$transaction(async (tx) => {
    await lockBranchSettlement(tx, settlementId);
    const settlement = await tx.branch_settlements.findUnique({ where: { id: settlementId } });
    if (!settlement) throw new AppError(404, "Branch settlement not found");
    if (settlement.status === "settled") throw new AppError(409, "This branch settlement is already complete");
    if (settlement.status === "cancelled") throw new AppError(409, "This branch settlement has been cancelled");

    const netPayable = money(settlement.net_payable);
    const alreadyPaid = money(settlement.paid_amount);
    const outstanding = round2(netPayable - alreadyPaid);
    if (paymentTotal <= 0 && outstanding > 0) throw new AppError(400, "Payment amount must be greater than zero");
    if (paymentTotal > outstanding) {
      throw new AppError(400, `Payment total (Rs. ${paymentTotal}) exceeds the outstanding balance (Rs. ${outstanding})`);
    }

    const newPaidAmount = round2(alreadyPaid + paymentTotal);
    const fullySettled = round2(netPayable - newPaidAmount) === 0;
    const method = Array.from(new Set(input.payments.map((payment) => payment.method.trim()))).join(", ");
    const allPayments = sumPaymentsByMethod([
      ...paymentLines(settlement.payments),
      ...input.payments.map((payment) => ({ method: payment.method.trim(), amount: payment.amount })),
    ]);

    const payment = await tx.branch_settlement_payments.create({ data: {
      settlement_id: settlementId,
      amount: paymentTotal,
      method,
      breakdown: input.payments as unknown as Prisma.InputJsonValue,
      remark: input.remark?.trim() || null,
      recorded_by: actor.id,
    } });
    const updated = await tx.branch_settlements.update({
      where: { id: settlementId },
      data: {
        paid_amount: newPaidAmount,
        status: fullySettled ? "settled" : "partially_paid",
        payment_method: allPayments.map((line) => line.method).join(", "),
        payments: allPayments as unknown as Prisma.InputJsonValue,
        ...(input.remark?.trim() ? { remark: input.remark.trim() } : {}),
        ...(fullySettled ? { settled_by: actor.id, settled_at: new Date() } : {}),
      },
    });
    await tx.audit_logs.create({ data: {
      actor_id: actor.id,
      entity_type: "branch_settlement",
      entity_id: settlementId,
      action: fullySettled ? "PAY_BRANCH_SETTLEMENT" : "PART_PAY_BRANCH_SETTLEMENT",
      new_data: { statementNo: settlement.statement_no, amount: paymentTotal, paidAmount: newPaidAmount,
        remainingAmount: round2(netPayable - newPaidAmount), paymentMethod: method, status: updated.status },
    } });
    return { updated, paymentId: payment.id, netPayable, newPaidAmount };
  }, { maxWait: 10_000, timeout: 20_000 });

  return {
    id: result.updated.id,
    statementNo: result.updated.statement_no,
    status: result.updated.status,
    netPayable: result.netPayable,
    paidAmount: result.newPaidAmount,
    remainingAmount: round2(result.netPayable - result.newPaidAmount),
    paymentId: result.paymentId,
  };
}
