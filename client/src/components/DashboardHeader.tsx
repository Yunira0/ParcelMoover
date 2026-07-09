import React, { useState, useEffect } from 'react';
import { getCurrentUser } from '../services/auth.service';
import { toBsDateLabel } from '../utils/nepaliDate';
import './DashboardHeader.css';

type DashboardHeaderProps = {
  user: string;
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
};

const formatDate = (date: Date) => {
  return `${date.toLocaleDateString(undefined, { weekday: 'long' })}, ${toBsDateLabel(date)}`;
};

const getGreeting = (hour: number) => {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ user }) => {
  const [userName, setUserName] = useState(user);
  const [now, setNow] = useState(new Date());

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

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="dashboard-header">
      <div className="welcome-section">
        <div className="welcome-text">
          <h1>{getGreeting(now.getHours())}, {userName}</h1>
          <p>Operational overview for Parcel Moover across the Nepal network.</p>
        </div>
      </div>
      
      <div className="time-section">
        <span className="current-time">{formatTime(now)}</span>
        <span className="current-date">{formatDate(now)}</span>
      </div>
    </div>
  );
};

export default DashboardHeader;
