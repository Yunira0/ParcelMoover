import React, { useState, useEffect } from 'react';
import { Building2, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '../services/auth.service';
import { toBsDateLabel } from '../utils/nepaliDate';
import { getCurrentUser as getStoredUser } from '../utils/auth';
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

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  sales: 'Sales',
  vendor: 'Vendor',
  vendor_staff: 'Vendor Staff',
  rider: 'Rider',
};

// Who's signed in and where: the highest role they hold, and their hub - a
// super admin with no hub oversees the whole network.
const describeViewer = () => {
  const stored = getStoredUser();
  const roles = stored?.roles ?? [];
  const role = Object.keys(ROLE_LABELS).find((r) => roles.includes(r));
  const hub = stored?.locationName?.trim();
  return {
    role: role ? ROLE_LABELS[role] : null,
    place: hub || (roles.includes('super_admin') ? 'All branches' : null),
  };
};

const getGreeting = (hour: number) => {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ user }) => {
  const [userName, setUserName] = useState(user);
  const [now, setNow] = useState(new Date());
  const viewer = describeViewer();

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
          {(viewer.role || viewer.place) && (
            <div className="welcome-meta">
              {viewer.role && (
                <span className="welcome-chip"><ShieldCheck size={14} /> {viewer.role}</span>
              )}
              {viewer.place && (
                <span className="welcome-chip"><Building2 size={14} /> {viewer.place}</span>
              )}
            </div>
          )}
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
