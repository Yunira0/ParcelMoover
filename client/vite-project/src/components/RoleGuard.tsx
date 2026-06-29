import React from 'react';
import { hasAnyRole } from '../utils/auth';
import NotAuthorized from '../pages/NotAuthorized';

interface RoleGuardProps {
  allowedRoles: string[];
  children: React.ReactNode;
}

// Sits inside ProtectedRoute (which only checks "is logged in"). This adds the
// "is this role allowed on this specific route" check - e.g. vendor-only finance
// pages shouldn't be reachable by typing the URL as a rider or another vendor's admin.
// Disallowed roles get an explicit "Not Authorized" page instead of a silent redirect.
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children }) => {
  if (!hasAnyRole(allowedRoles)) {
    return <NotAuthorized />;
  }

  return <>{children}</>;
};

export default RoleGuard;
