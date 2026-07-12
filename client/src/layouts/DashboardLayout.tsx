import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TopNav from '../components/TopNav';
import { StaffPermissionsProvider } from '../context/StaffPermissionsContext';
import { MobileNavProvider } from '../context/MobileNavContext';
import './DashboardLayout.css';

const DashboardLayout: React.FC = () => {
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
