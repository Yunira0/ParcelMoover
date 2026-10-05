// The `accountant` role: an office account that runs the whole Finance side
// (vendor/rider COD settlements, vendor billing, COD settlement requests, the
// accounting books, and branch COD settlements) and nothing else - no orders,
// operations, users or settings.
//
// Like `sales`, it is an admins-profile account whose department ("Accountant")
// swaps the base `admin` role for its own at creation (see auth.service.ts), so
// every "is this admin/staff" check elsewhere in the app keeps excluding it.
// Finance code paths opt it in explicitly through the helpers below.

type RoleActor = { roles: string[] };

export const ACCOUNTANT_ROLE = "accountant";

export function isAccountant(actor: RoleActor): boolean {
  return actor.roles.includes(ACCOUNTANT_ROLE);
}

/**
 * Office-wide finance authority: unscoped by branch, and allowed the finance
 * actions otherwise reserved for super_admin (e.g. recording a branch COD
 * settlement payment). super_admin or accountant.
 */
export function hasOfficeFinanceAuthority(actor: RoleActor): boolean {
  return actor.roles.includes("super_admin") || isAccountant(actor);
}

/** Staff for finance purposes: super_admin, admin or accountant. */
export function isFinanceStaff(actor: RoleActor): boolean {
  return actor.roles.some((r) => r === "super_admin" || r === "admin" || r === ACCOUNTANT_ROLE);
}
