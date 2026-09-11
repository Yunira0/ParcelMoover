import React from 'react';
import { getCurrentUserRoles, hasAnyRole, hasAdminPermission, hasStaffPermission, isBranchWorkspaceUser } from '../utils/auth';
import NotAuthorized from '../pages/NotAuthorized';

interface RoleGuardProps {
  allowedRoles: string[];
  /**
   * When set and the current user is a vendor_staff account, also requires
   * this permission (matching the API's per-route requireStaffPermission
   * check) - so a staff member can't reach a page their vendor didn't grant
   * them access to, even if they open the URL directly.
   */
  requiredPermission?: string;
  /**
   * When set and the current user is a plain admin (not super_admin), also
   * requires this delegated permission (matching the API's per-route
   * requireAdminPermission check) - e.g. SETTINGS_ACCESS for the Settings
   * section a super_admin opened up to them.
   */
  adminPermission?: string;
  /**
   * When set alongside adminPermission, a branch-workspace admin also passes
   * the permission check with no explicit delegation needed - for pages whose
   * API already scopes them to the admin's own branch (e.g. Route Rates),
   * so the permission only gates the unscoped, whole-network view.
   */
  allowBranchWorkspace?: boolean;
  children: React.ReactNode;
}

// Sits inside ProtectedRoute (which only checks "is logged in"). This adds the
// "is this role allowed on this specific route" check - e.g. vendor-only finance
// pages shouldn't be reachable by typing the URL as a rider or another vendor's admin.
// Disallowed roles get an explicit "Not Authorized" page instead of a silent redirect.
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, requiredPermission, adminPermission, allowBranchWorkspace, children }) => {
  if (!hasAnyRole(allowedRoles)) {
    return <NotAuthorized />;
  }

  const isStaff = getCurrentUserRoles().includes('vendor_staff');
  if (isStaff && requiredPermission && !hasStaffPermission(requiredPermission)) {
    return <NotAuthorized />;
  }

  if (adminPermission && !hasAdminPermission(adminPermission) && !(allowBranchWorkspace && isBranchWorkspaceUser())) {
    return <NotAuthorized />;
  }

  return <>{children}</>;
};

export default RoleGuard;
