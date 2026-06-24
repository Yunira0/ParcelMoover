import React from 'react';
import type { LucideIcon } from 'lucide-react';
import './StatCard.css';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value }) => {
  return (
    <div className="stat-card">
      <div className="stat-icon-wrapper">
        <Icon className="stat-icon" size={24} />
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </div>
  );
};

export default StatCard;
