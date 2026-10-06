import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  ACCOUNTANT_HOME,
  getCurrentUser,
  isAccountantPathAllowed,
  isAccountantUser,
  isBranchWorkspacePathAllowed,
  isBranchWorkspaceUser,
} from '../utils/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const location = useLocation();
  const user = getCurrentUser();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Block access to every protected route until the user sets a permanent password.
  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  // A branch workspace is intentionally small: its operator can work the
  // assigned branch's orders and money handoff, but cannot reach head-office
  // screens by pasting their URLs. Order creation/trash are also excluded.
  if (isBranchWorkspaceUser()) {
    if (!isBranchWorkspacePathAllowed(location.pathname)) {
      return <Navigate to="/orders" replace />;
    }
  }

  // The accountant works the Finance section only; any other URL (including
  // /dashboard, where every login lands) goes to the finance overview.
  if (isAccountantUser() && !isAccountantPathAllowed(location.pathname)) {
    return <Navigate to={ACCOUNTANT_HOME} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
