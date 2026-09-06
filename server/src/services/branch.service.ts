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
} from "../validators/branch.schema";

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
    where: { user_id: actor.id }, select: { location_id: true, permissions: true },
  });
  return {
    locationId: admin?.location_id ?? null,
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
      ...(settlement === "settled" ? [{ branch_settlement_items: { some: {} } }] : []),
      ...(settlement === "pending" ? [{ branch_settlement_items: { none: {} } }] : [])],
  };
  const aggregate = await prisma.parcels.aggregate({ where: scoped, _count: { _all: true }, _sum: { cod_amount: true } });
  if (settlement === "settled") {
    const settled = await prisma.branch_settlement_items.aggregate({
      where: { parcel: scoped }, _sum: { collected_amount: true },
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
    ...(query.dateFrom || query.dateTo ? { dateField: "createdAt" as const } : {}),
    ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo ? { dateTo: query.dateTo } : {}),
  };
}

export async function listBranchOrders(actor: OrderActor, query: BranchTrackingQuery) {
  return listOrders(actor, { ...(await orderQuery(query)),
    ...(query.page !== undefined ? { page: query.page } : {}),
    ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.dir ? { dir: query.dir } : {}),
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

export async function listBranchSettlements(query: BranchSettlementQuery) {
  const where: Prisma.branch_settlementsWhereInput = {
    ...(query.fromBranchId ? { from_branch_id: query.fromBranchId } : {}),
    ...(query.toBranchId ? { to_branch_id: query.toBranchId } : {}),
    ...(query.dateFrom || query.dateTo ? { settlement_date: {
      ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
      ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
    } } : {}),
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.branch_settlements.count({ where }),
    prisma.branch_settlements.findMany({ where, skip, take: query.pageSize, orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      include: { from_branch: { select: { name: true } }, to_branch: { select: { name: true } }, _count: { select: { items: true } } } }),
  ]);
  return { data: rows.map((s) => ({
    id: s.id, statementNo: s.statement_no, fromBranch: s.from_branch.name, toBranch: s.to_branch.name,
    settlementDate: s.settlement_date.toISOString().slice(0, 10), orderCount: s._count.items,
    grossCod: money(s.gross_cod), commissionAmount: money(s.commission_amount), netPayable: money(s.net_payable),
    commissionPerParcel: money(s.commission_per_parcel), status: s.status, paymentMethod: s.payment_method, remark: s.remark,
  })), meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

export async function createBranchSettlement(actor: OrderActor, input: CreateBranchSettlementInput) {
  const [originIds, destinationIds, fromBranch] = await Promise.all([
    resolveBranchLocationIds(input.fromBranchId), resolveBranchLocationIds(input.toBranchId),
    prisma.locations.findUnique({ where: { id: input.fromBranchId }, select: { commission_per_parcel: true } }),
  ]);
  const ids = [...new Set(input.orderIds)];
  return prisma.$transaction(async (tx) => {
    const parcels = await tx.parcels.findMany({
      where: { id: { in: ids }, deleted_at: null, status: { in: DELIVERED },
        origin_location_id: { in: originIds! }, destination_location_id: { in: destinationIds! },
        branch_settlement_items: { none: {} } },
      select: { id: true, cod_amount: true, cod_collections: { select: { collected_amount: true } } },
    });
    if (parcels.length !== ids.length) throw new AppError(409, "Some selected orders are ineligible, outside this branch pair, or already deposited");
    const commission = new Prisma.Decimal(input.commissionPerParcel ?? money(fromBranch?.commission_per_parcel));
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
      statement_no: statementNo, from_branch_id: input.fromBranchId, to_branch_id: input.toBranchId,
      settlement_date: new Date(`${input.settlementDate}T00:00:00.000Z`), commission_per_parcel: commission,
      gross_cod: gross, commission_amount: commissionAmount, net_payable: net,
      payment_method: input.paymentMethod || null, remark: input.remark || null, created_by: actor.id,
      items: { create: itemAmounts.map((i) => ({ parcel_id: i.parcelId, collected_amount: i.collected,
        commission_amount: i.commission, net_payable: i.net })) },
    } });
    await tx.audit_logs.create({ data: { actor_id: actor.id, entity_type: "branch_settlement", entity_id: settlement.id,
      action: "CREATE_BRANCH_SETTLEMENT", new_data: { statementNo, orderIds: ids, netPayable: net.toString() } } });
    return { id: settlement.id, statementNo, orderCount: ids.length, grossCod: money(gross),
      commissionAmount: money(commissionAmount), netPayable: money(net) };
  });
}
