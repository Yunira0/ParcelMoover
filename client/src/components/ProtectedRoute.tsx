import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCurrentUser } from '../utils/auth';

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

  return <>{children}</>;
};

export default ProtectedRoute;
