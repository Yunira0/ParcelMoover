import React from 'react';
import { Navigate } from 'react-router-dom';
import { hasAnyRole } from '../utils/auth';

interface RoleGuardProps {
  allowedRoles: string[];
  children: React.ReactNode;
}

// Sits inside ProtectedRoute (which only checks "is logged in"). This adds the
// "is this role allowed on this specific route" check - e.g. vendor-only finance
// pages shouldn't be reachable by typing the URL as a rider or another vendor's admin.
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children }) => {
  if (!hasAnyRole(allowedRoles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;
