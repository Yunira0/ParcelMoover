// pm-stats reports people in three groups. A person with several roles is
// counted once, in the first group that matches: rider, then vendor, then
// staff. Vendor sub-accounts (vendor_staff) count as vendors.
//
// userGroupSql must apply the same rule in SQL; keep the two together.

import { Prisma } from "../../generated/prisma/client";

export const USER_GROUPS = ["staff", "vendor", "rider"] as const;
export type UserGroup = (typeof USER_GROUPS)[number];

const VENDOR_ROLES = new Set(["vendor", "vendor_staff"]);

export function userGroupFor(roles: readonly string[]): UserGroup {
  if (roles.includes("rider")) return "rider";
  if (roles.some((role) => VENDOR_ROLES.has(role))) return "vendor";
  return "staff";
}

// Aggregate over a user's role rows (alias `r`), grouped by user.
export const userGroupSql = Prisma.sql`
  CASE
    WHEN bool_or(r.code = 'rider') THEN 'rider'
    WHEN bool_or(r.code IN ('vendor', 'vendor_staff')) THEN 'vendor'
    ELSE 'staff'
  END`;
