import { Prisma } from "../generated/prisma/client";
import prisma from "./prisma";
import { AppError } from "../utils/AppError";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Every location a branch "covers": the branch hub itself, its active covered
 * areas, and - one level only - each virtually-covered branch plus that
 * branch's own active covered areas. Mirrors resolveBranchLocationIds in
 * branch.service, kept here so auth/finance consumers can branch-scope without
 * pulling that module's dependency graph.
 */
export async function resolveBranchCoverageIds(branchId: string): Promise<string[]> {
  const branch = await prisma.locations.findFirst({
    where: { id: branchId, parent_id: null, is_hub: true, is_active: true },
    select: {
      id: true,
      other_locations: { where: { is_active: true }, select: { id: true } },
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
    ...branch.other_locations.map((area) => area.id),
    ...branch.branch_virtual_coverage_branch.flatMap((coverage) => [
      coverage.covered_branch.id,
      ...coverage.covered_branch.other_locations.map((area) => area.id),
    ]),
  ];
}

/**
 * "This parcel touches the branch" as a plain Prisma filter - matches whenever
 * the branch's coverage is the parcel's origin, destination, or current
 * location. The same OR-of-three-columns rule order.service uses internally.
 */
export function branchParcelFilter(locationIds: string[]) {
  return {
    OR: [
      { origin_location_id: { in: locationIds } },
      { destination_location_id: { in: locationIds } },
      { current_location_id: { in: locationIds } },
    ],
  };
}

type ScopeActor = { id: string; roles: string[] };

/**
 * The location ids a branch-scoped admin is limited to, or undefined when the
 * actor is not branch-limited: super_admin, a non-admin, an admin with no
 * assigned branch, or one lifted by BRANCH_TRACKING_READ/WRITE (the same rule
 * getAdminBranchScope applies in order.service).
 */
export async function adminBranchScopeIds(actor: ScopeActor): Promise<string[] | undefined> {
  if (actor.roles.includes("super_admin") || !actor.roles.includes("admin")) return undefined;
  const admin = await prisma.admins.findFirst({
    where: { user_id: actor.id },
    select: {
      location_id: true,
      branch_scoped: true,
      permissions: true,
      locations: { select: { code: true } },
    },
  });
  if (!admin?.branch_scoped || !admin.location_id) return undefined;
  if (admin.permissions.some((p) => p === "BRANCH_TRACKING_READ" || p === "BRANCH_TRACKING_WRITE")) {
    return undefined;
  }
  // Imadol is the central hub - its admins are never branch-limited, even when
  // flagged branch_scoped.
  if (admin.locations?.code?.trim().toUpperCase() === "IMADOL") return undefined;
  return resolveBranchCoverageIds(admin.location_id);
}

/**
 * Some actions (vendor COD settlement, and anything else scoped the same way)
 * are centralised at head office rather than delegated to branches at all -
 * unlike most of the app, a branch-scoped admin isn't narrowed to their own
 * branch here, they're blocked outright. Shared by every caller that needs
 * this exact rule so it can't drift between them.
 */
export async function assertHeadOfficeOnly(actor: ScopeActor, message: string): Promise<void> {
  const ids = await adminBranchScopeIds(actor);
  if (ids) throw new AppError(403, message);
}

/**
 * What an admin's branch_scoped should be, computed from their hub alone:
 * true for every hub except Imadol, false with no hub or at Imadol. Called at
 * admin create/update time instead of reading a client-supplied value - the
 * flag is no longer a manual toggle.
 */
export async function deriveBranchScoped(db: Db, locationId: string | null): Promise<boolean> {
  if (!locationId) return false;
  const location = await db.locations.findUnique({ where: { id: locationId }, select: { code: true } });
  return location?.code?.trim().toUpperCase() !== "IMADOL";
}
