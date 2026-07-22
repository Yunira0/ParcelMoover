import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import TopNav from '../components/TopNav';
import Button from '../components/Button';
import { StaffPermissionsProvider } from '../context/StaffPermissionsContext';
import { MobileNavProvider } from '../context/MobileNavContext';
import { isRiderOnly } from '../utils/auth';
import { logout } from '../services/auth.service';
import './DashboardLayout.css';

// Riders have a dedicated Rider app; the web panel has no rider experience, so
// block them here instead of letting them fall through to the admin views.
const RiderNotice: React.FC = () => {
  const navigate = useNavigate();
  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore — clear locally regardless
    } finally {
      localStorage.removeItem('user');
      navigate('/login');
    }
  };
  return (
    <div className="rider-notice">
      <Smartphone size={40} />
      <h1>Use the Rider app</h1>
      <p>Rider accounts are managed from the ParcelMoover Rider app. The web dashboard isn’t available for riders.</p>
      <Button variant="primary" onClick={handleLogout}>Log out</Button>
    </div>
  );
};

const DashboardLayout: React.FC = () => {
  if (isRiderOnly()) return <RiderNotice />;

  return (
    <StaffPermissionsProvider>
      <MobileNavProvider>
        <div className="dashboard-layout">
          <TopNav />
          <div className="dashboard-body">
            <Sidebar />
            <main className="dashboard-content">
              <Outlet />
            </main>
          </div>
        </div>
      </MobileNavProvider>
    </StaffPermissionsProvider>
  );
};

export default DashboardLayout;
