import React from 'react';
import { Link } from 'react-router-dom';
import type { DashboardSummary } from '../services/orders.service';
import './TodayOverview.css';

interface OverviewItemProps {
  label: string;
  value: string | number;
  /** When set, the tile links to the page listing the parcels behind the number. */
  to?: string;
}

const OverviewItem: React.FC<OverviewItemProps> = ({ label, value, to }) => {
  const content = (
    <>
      <span className="today-label">{label}</span>
      <span className="today-value">{value}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="today-overview-card today-overview-card-link" aria-label={`${label}: ${value} — view details`}>
        {content}
      </Link>
    );
  }

  return <div className="today-overview-card">{content}</div>;
};

interface TodayOverviewProps {
  data: DashboardSummary['today'];
  loading?: boolean;
}

// Today's date in Nepal local time (UTC+5:45) - matches the server's day bucketing.
const nepalToday = () =>
  new Date(Date.now() + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10);

const TodayOverview: React.FC<TodayOverviewProps> = ({ data, loading = false }) => {
  const displayValue = (value: number) => loading ? '...' : value.toLocaleString();
  const today = nepalToday();

  return (
    <div className="today-overview">
      <h3 className="section-title">Today's Overview</h3>
      <div className="today-grid">
        <OverviewItem
          label="Total Orders"
          value={displayValue(data.totalOrders)}
          to={`/orders?dateFrom=${today}&dateTo=${today}`}
        />
        <OverviewItem label="Delivered" value={displayValue(data.delivered)} to="/orders?tab=delivered" />
        <OverviewItem label="In Transit" value={displayValue(data.inTransit)} to="/orders?tab=inprogress" />
        <OverviewItem
          label="Returns"
          value={displayValue(data.returns)}
          to={`/orders?orderType=return&dateFrom=${today}&dateTo=${today}`}
        />
      </div>
    </div>
  );
};

export default TodayOverview;
