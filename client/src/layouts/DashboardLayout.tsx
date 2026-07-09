import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TopNav from '../components/TopNav';
import { StaffPermissionsProvider } from '../context/StaffPermissionsContext';
import './DashboardLayout.css';

const DashboardLayout: React.FC = () => {
  return (
    <StaffPermissionsProvider>
      <div className="dashboard-layout">
        <TopNav />
        <div className="dashboard-body">
          <Sidebar />
          <main className="dashboard-content">
            <Outlet />
          </main>
        </div>
      </div>
    </StaffPermissionsProvider>
  );
};

export default DashboardLayout;
