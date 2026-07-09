import React from 'react';
import type { DashboardSummary } from '../services/orders.service';
import './TodayOverview.css';

interface OverviewItemProps {
  label: string;
  value: string | number;
}

const OverviewItem: React.FC<OverviewItemProps> = ({ label, value }) => {
  return (
    <div className="today-overview-card">
      <span className="today-label">{label}</span>
      <span className="today-value">{value}</span>
    </div>
  );
};

interface TodayOverviewProps {
  data: DashboardSummary['today'];
  loading?: boolean;
}

const TodayOverview: React.FC<TodayOverviewProps> = ({ data, loading = false }) => {
  const displayValue = (value: number) => loading ? '...' : value.toLocaleString();

  return (
    <div className="today-overview">
      <h3 className="section-title">Today's Overview</h3>
      <div className="today-grid">
        <OverviewItem label="Total Orders" value={displayValue(data.totalOrders)} />
        <OverviewItem label="Delivered" value={displayValue(data.delivered)} />
        <OverviewItem label="In Transit" value={displayValue(data.inTransit)} />
        <OverviewItem label="Returns" value={displayValue(data.returns)} />
      </div>
    </div>
  );
};

export default TodayOverview;
