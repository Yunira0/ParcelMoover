import React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import './StatCard.css';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  /** When set, the card becomes a link to the page holding the detail behind the number. */
  to?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, to }) => {
  const content = (
    <>
      <div className="stat-icon-wrapper">
        <Icon className="stat-icon" size={24} />
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="stat-card stat-card-link" aria-label={`${label}: ${value} — view details`}>
        {content}
      </Link>
    );
  }

  return <div className="stat-card">{content}</div>;
};

export default StatCard;
