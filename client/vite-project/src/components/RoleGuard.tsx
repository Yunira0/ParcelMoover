import React from 'react';
import { getCurrentUserRoles, hasAnyRole, hasStaffPermission } from '../utils/auth';
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
  children: React.ReactNode;
}

// Sits inside ProtectedRoute (which only checks "is logged in"). This adds the
// "is this role allowed on this specific route" check - e.g. vendor-only finance
// pages shouldn't be reachable by typing the URL as a rider or another vendor's admin.
// Disallowed roles get an explicit "Not Authorized" page instead of a silent redirect.
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, requiredPermission, children }) => {
  if (!hasAnyRole(allowedRoles)) {
    return <NotAuthorized />;
  }

  const isStaff = getCurrentUserRoles().includes('vendor_staff');
  if (isStaff && requiredPermission && !hasStaffPermission(requiredPermission)) {
    return <NotAuthorized />;
  }

  return <>{children}</>;
};

export default RoleGuard;
