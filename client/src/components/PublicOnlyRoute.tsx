import React from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentUser } from '../utils/auth';

interface PublicOnlyRouteProps {
  children: React.ReactNode;
}

// Mirrors ProtectedRoute in reverse: keeps an already-logged-in user off the
// public landing page (they've already picked their side — ops or vendor —
// showing the marketing Home page again would just add a click back to
// /dashboard) without touching /track or /login for a still-logged-out visitor.
const PublicOnlyRoute: React.FC<PublicOnlyRouteProps> = ({ children }) => {
  const user = getCurrentUser();

  if (user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : '/dashboard'} replace />;
  }

  return <>{children}</>;
};

export default PublicOnlyRoute;
