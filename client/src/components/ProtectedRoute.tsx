import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Button from './Button';
import PageLoader from './PageLoader';
import { getCurrentUser as getServerUser } from '../services/auth.service';
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
  const isAdmin = user?.roles?.some((role) => role === 'admin' || role === 'super_admin') ?? false;
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isAdmin || !user?.id) return;

    let active = true;
    getServerUser()
      .then((serverUser) => {
        if (!active) return;
        const serverIsAdmin = Array.isArray(serverUser?.roles) &&
          serverUser.roles.some((role: string) => role === 'admin' || role === 'super_admin');
        if (serverUser?.id !== user.id || !serverIsAdmin) {
          // A rider login on the same localhost host could replace the browser
          // cookie while leaving this dashboard's cached admin profile intact.
          localStorage.removeItem('user');
          setSessionChanged(true);
          return;
        }
        setVerificationFailed(false);
        setVerifiedUserId(user.id);
      })
      .catch(() => {
        if (active) setVerificationFailed(true);
      });

    return () => { active = false; };
  }, [isAdmin, user?.id, retryCount]);

  if (sessionChanged) {
    return <Navigate to="/login?session=changed" state={{ from: location }} replace />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Block access to every protected route until the user sets a permanent password.
  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  // Do not mount the admin shell until its server cookie matches the cached
  // profile. Its providers and dashboard otherwise fire privileged requests
  // under whichever account last signed in on this host.
  if (isAdmin && verifiedUserId !== user.id) {
    if (verificationFailed) {
      return (
        <div className="login-page">
          <div className="login-card">
            <h2>Couldn’t verify your session</h2>
            <p>Check your connection, then try again.</p>
            <Button type="button" variant="primary" onClick={() => {
              setVerificationFailed(false);
              setRetryCount((count) => count + 1);
            }}>Try again</Button>
          </div>
        </div>
      );
    }
    return <PageLoader />;
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
