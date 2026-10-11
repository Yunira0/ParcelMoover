// Department workspaces for head-office admins: "Operation" and "Customer
// Experience".
//
// Unlike Sales and Accountant (which swap the `admin` role for their own at
// account creation - see auth.service.ts), these departments stay on the plain
// `admin` role, so every operations / support page they work already passes the
// server's role gates. The department only narrows which pages the web shell
// offers (client/src/utils/auth.ts, getDepartmentWorkspace), the same way the
// branch workspace is narrowed. It is read live from admins.department, so
// changing the department on Edit Admin takes effect on the account's next
// /me refresh. Extra screens are still unlocked per account through the
// delegated admin permissions on Edit Admin.
//
// The one grant a department brings with it is read-only Branch Overview, which
// both workspaces list. It never applies to a branch-scoped admin: their branch
// workspace takes precedence, and BRANCH_TRACKING_READ would lift their scope.

import type { AdminPermission } from "../types/adminPermission.type";

const DEPARTMENT_PERMISSIONS: Record<string, readonly AdminPermission[]> = {
  operation: ["BRANCH_TRACKING_READ"],
  "customer experience": ["BRANCH_TRACKING_READ"],
};

export function departmentImpliesPermission(
  admin: { department: string | null; branch_scoped: boolean },
  permission: AdminPermission,
): boolean {
  if (admin.branch_scoped) return false;
  const implied = DEPARTMENT_PERMISSIONS[(admin.department ?? "").trim().toLowerCase()];
  return implied?.includes(permission) ?? false;
}
