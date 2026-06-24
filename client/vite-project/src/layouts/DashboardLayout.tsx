import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TopNav from '../components/TopNav';
import './DashboardLayout.css';

const DashboardLayout: React.FC = () => {
  return (
    <div className="dashboard-layout">
      <TopNav />
      <div className="dashboard-body">
        <Sidebar />
        <main className="dashboard-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
