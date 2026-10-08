// Internal staff names are masked in customer-facing remarks and timelines.
const STAFF_ROLE_CODES = new Set(["super_admin", "admin"]);

export function isStaffAuthor(
  user: { user_roles?: { roles: { code: string } }[] } | null | undefined,
): boolean {
  return !!user?.user_roles?.some((ur) => STAFF_ROLE_CODES.has(ur.roles.code));
}
