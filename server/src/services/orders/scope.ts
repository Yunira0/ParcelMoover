import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { resolveBranchCoverageIds } from "../../lib/branchScope";
import { AppError } from "../../utils/AppError";
import { resolveOwnVendorId } from "../vendor-scope.service";
import type { OrderActor } from "./types";

// A rider may progress a parcel only on their assigned leg.
export const PICKUP_LEG_STATUSES: parcel_status[] = ["pickup_ordered", "rider_assigned", "picked_up", "failed_pickup"];

// A pickup rider keeps custody only until the parcel leaves the pickup leg.
// The same statuses drive both Prisma filters and the SQL rider scope.
export const PICKUP_RIDER_CUSTODY_STATUSES: parcel_status[] = [...PICKUP_LEG_STATUSES, "arrived"];

export function riderCustodyFilter(riderId: string): Prisma.parcelsWhereInput {
  return {
    OR: [
      { delivery_rider_id: riderId },
      { pickup_rider_id: riderId, status: { in: PICKUP_RIDER_CUSTODY_STATUSES } },
    ],
  };
}

/** Parcels a branch originated or currently handles. Inbound parcels at other hubs are excluded. */
export function branchHandlesFilter(branchLocationIds: string[]): Prisma.parcelsWhereInput {
  return {
    OR: [
      { origin_location_id: { in: branchLocationIds } },
      { current_location_id: { in: branchLocationIds } },
    ],
  };
}

export const DELIVERY_LEG_STATUSES: parcel_status[] = ["ready_to_deliver", "sent_for_delivery", "failed_delivery"];

// Rider read scope comes in two strengths, because "parcels I am responsible
// for right now" and "parcels I ever handled" are different questions and were
// previously answered by the same flat
// `pickup_rider_id = me OR delivery_rider_id = me`.
//
// ── Custody: what the rider app LISTS ────────────────────────────────────────
// A parcel is in a rider's list if they are its delivery rider, or if they are
// its pickup rider and it has not yet left the origin hub. Their custody ends
// at that handover: from dispatch onward the parcel is in someone else's hands
// - another hub, a delivery rider, or a 3PL - and it never comes back to them,
// not even once delivered.
//
// Both halves of the NCM complaint live here. A carrier moves the parcel to
// sent_for_delivery and then delivered with delivery_rider_id still NULL, so a
// scope that let the pickup rider keep it (a) dropped live NCM orders into
// their queue with delivery buttons that assertRiderOwnsLeg 403s on, and
// (b) filed NCM's completed deliveries under "Orders you have delivered" for
// whoever happened to collect the parcel days earlier.
//
// This is also the rule that matters most operationally: it works on APKs
// already installed in the field, because the server simply stops returning
// the rows the old client asks for.
// Same rule for the raw-SQL queries. `alias` prefixes the columns when the
// query joins (e.g. "p."); empty for single-table scans.
export function riderCustodySql(riderId: string, alias = ""): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${alias}${name}`);
  return Prisma.sql`AND (
    ${col("delivery_rider_id")} = ${riderId}::uuid
    OR (${col("pickup_rider_id")} = ${riderId}::uuid
        AND ${col("status")}::text = ANY(${PICKUP_RIDER_CUSTODY_STATUSES}))
  )`;
}

// ── Handled: what the rider's STATS count ───────────────────────────────────
// Deliberately looser. "Picked Up" on the rider dashboard is a tally of work
// done, not a task list, so a parcel they collected still counts while it is in
// transit or out with a 3PL - narrowing this to custody would drop a rider's
// headline number to near zero whenever their day's pickups are mid-transit.
// The delivery leg is still excluded: a parcel out with a different rider was
// never this one's to count.
export function riderHandledFilter(riderId: string): Prisma.parcelsWhereInput {
  return {
    OR: [
      { delivery_rider_id: riderId },
      { pickup_rider_id: riderId, status: { notIn: DELIVERY_LEG_STATUSES } },
    ],
  };
}

export function riderHandledSql(riderId: string, alias = ""): Prisma.Sql {
  return riderScopeSqlFor(riderId, DELIVERY_LEG_STATUSES, alias);
}

function riderScopeSqlFor(riderId: string, excluded: parcel_status[], alias: string): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${alias}${name}`);
  return Prisma.sql`AND (
    ${col("delivery_rider_id")} = ${riderId}::uuid
    OR (${col("pickup_rider_id")} = ${riderId}::uuid
        AND ${col("status")}::text <> ALL(${excluded}))
  )`;
}

export async function resolveActiveRider(riderId: string) {
  const rider = await prisma.riders.findFirst({
    where: { id: riderId, deleted_at: null, status: "active" },
  });
  if (!rider) {
    throw new AppError(400, "Rider not found or inactive");
  }
  return rider;
}

/**
 * Broad branch scope: the parcel touches the branch anywhere - where it came
 * from, where it's headed, or where it currently sits. Used for write
 * enforcement (a branch may act on an inbound parcel before it arrives) and
 * direct single-parcel lookups. Read lists/aggregates use branchHandlesFilter.
 */
export function branchTouchesFilter(branchLocationIds: string[]): Prisma.parcelsWhereInput {
  return {
    OR: [
      { origin_location_id: { in: branchLocationIds } },
      { destination_location_id: { in: branchLocationIds } },
      { current_location_id: { in: branchLocationIds } },
    ],
  };
}

/** Raw-SQL form of branchHandlesFilter (origin OR current, no destination). */
export function branchHandlesSql(branchLocationIds: string[], alias = ""): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${alias}${name}`);
  return Prisma.sql`AND (
    ${col("origin_location_id")} = ANY(${branchLocationIds}::uuid[]) OR
    ${col("current_location_id")} = ANY(${branchLocationIds}::uuid[])
  )`;
}

/**
 * An admin's own order visibility, restricted to their assigned hub's
 * coverage - every admin with a hub, Imadol included, unless they hold
 * BRANCH_TRACKING_READ/WRITE (the same permission that already unlocks the
 * dedicated Branch Tracking pages).
 *
 * Deliberately does NOT key off branch_scoped like every other branch-scoping
 * check in the app (remarks, COD settlement, vendor/rider management,
 * finance, delivery rates, transit/return manifests, all via
 * lib/branchScope.ts's adminBranchScopeIds): those stay unrestricted at
 * Imadol because branch_scoped is auto-derived false there (see
 * deriveBranchScoped), but order visibility must still narrow to Imadol's own
 * orders for an Imadol-based admin - so this checks location_id alone.
 *
 * super_admin is never scoped here regardless of any admins row.
 */
export async function getAdminBranchScope(actor: OrderActor): Promise<string[] | undefined> {
  if (actor.roles.includes("super_admin") || !actor.roles.includes("admin")) return undefined;
  const admin = await prisma.admins.findFirst({
    where: { user_id: actor.id },
    select: { location_id: true, permissions: true },
  });
  if (!admin?.location_id) return undefined;
  if (admin.permissions.some((p) => p === "BRANCH_TRACKING_READ" || p === "BRANCH_TRACKING_WRITE")) return undefined;
  return resolveBranchCoverageIds(admin.location_id);
}

export async function getActorScope(actor: OrderActor) {
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");
  const actorIsRider = actor.roles.includes("rider");
  const actorIsSales = actor.roles.includes("sales");
  const branchLocationIds = await getAdminBranchScope(actor);

  // Vendor / vendor staff: resolved through the shared helper so both roles
  // land on the same vendor-scoping guarantees used elsewhere (finance, pricing).
  const ownVendorId = await resolveOwnVendorId(actor);
  if (ownVendorId) {
    return { vendorId: ownVendorId, vendorIds: undefined, riderId: undefined, branchLocationIds: undefined };
  }

  // Sales: scoped to the set of vendors (clients) they own. Staff/super_admin
  // are unrestricted, so this only applies to a pure sales account.
  if (actorIsSales && !isStaff) {
    const ownedVendors = await prisma.vendors.findMany({
      where: { sales_user_id: actor.id, deleted_at: null },
      select: { id: true },
    });
    return { vendorId: undefined, vendorIds: ownedVendors.map((v) => v.id), riderId: undefined, branchLocationIds: undefined };
  }

  const rider = actorIsRider
    ? await prisma.riders.findFirst({
        where: { user_id: actor.id, deleted_at: null, status: "active" },
        select: { id: true },
      })
    : null;

  if (actorIsRider && !rider) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  return { vendorId: undefined, vendorIds: undefined, riderId: rider?.id, branchLocationIds };
}
