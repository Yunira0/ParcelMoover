import React, { useState, useEffect } from 'react';
import { getCurrentUser } from '../services/auth.service';
import './DashboardHeader.css';

type DashboardHeaderProps = {
  user: string;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ user }) => {
  const [userName, setUserName] = useState(user);

  useEffect(() => {
    getCurrentUser()
      .then(data => {
        if (data && data.fullName) {
          setUserName(data.fullName);
        }
      })
      .catch(err => {
        console.error("Failed to load user in header:", err);
      });
  }, [user]);

  return (
    <div className="dashboard-header">
      <div className="welcome-section">
        <div className="welcome-text">
          <h1>Good Morning, {userName}</h1>
          <p>Operational overview for Parcel Moover across the Nepal network.</p>
        </div>
      </div>
      
      <div className="time-section">
        <span className="current-time">17:54 PM</span>
        <span className="current-date">Friday 15 May</span>
      </div>
    </div>
  );
};

export default DashboardHeader;
