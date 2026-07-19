import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Check, Truck, Package, RotateCcw, Undo2, MessageSquare, type LucideIcon } from 'lucide-react';
import type { DashboardSummary } from '../services/orders.service';
import './TodayOverview.css';

interface TodayOverviewProps {
  today: DashboardSummary['today'];
  overview: DashboardSummary['overview'];
  loading?: boolean;
}

interface ActivityRow {
  icon: LucideIcon;
  label: string;
  value: number;
  to: string;
  /** Semantic color for the value; falls back to default text when omitted. */
  color?: string;
}

// Today's date in Nepal local time (UTC+5:45) - matches the server's day bucketing.
const nepalToday = () =>
  new Date(Date.now() + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10);

const TodayOverview: React.FC<TodayOverviewProps> = ({ today, overview, loading = false }) => {
  const date = nepalToday();

  const rows: ActivityRow[] = [
    { icon: ClipboardList, label: 'New orders', value: today.totalOrders, to: `/orders?dateFrom=${date}&dateTo=${date}` },
    { icon: Check, label: 'Delivered', value: today.delivered, to: '/orders?tab=delivered', color: 'var(--color-success-default)' },
    { icon: Truck, label: 'In transit', value: today.inTransit, to: '/orders?tab=inprogress', color: 'var(--color-info-text)' },
    { icon: Package, label: 'Pending deliveries', value: overview.pendingDeliveries, to: '/orders?tab=inprogress&currentStatus=ready_to_deliver&currentStatus=sent_for_delivery&currentStatus=oov', color: 'var(--color-background-warning-default)' },
    { icon: RotateCcw, label: 'Returned', value: today.returnedToVendor, to: '/orders?currentStatus=returned_to_vendor', color: 'var(--color-danger-default)' },
    { icon: Undo2, label: 'Pending returns', value: overview.pendingReturns, to: '/return', color: 'var(--color-background-warning-default)' },
    { icon: MessageSquare, label: 'Unclosed remarks', value: today.unclosedComments, to: '/unclosed-remarks', color: 'var(--color-primary)' },
  ];

  return (
    <div className="today-overview">
      <h3 className="section-title">Today's activity</h3>
      <dl className="today-activity">
        {rows.map(({ icon: Icon, label, value, to, color }) => (
          <Link key={label} to={to} className="today-activity-row" aria-label={`${label}: ${loading ? 'loading' : value} — view details`}>
            <dt className="today-activity-term">
              <Icon size={17} className="today-activity-icon" />
              {label}
            </dt>
            <dd className="today-activity-value" style={color ? { color } : undefined}>
              {loading ? '…' : value.toLocaleString()}
            </dd>
          </Link>
        ))}
      </dl>
    </div>
  );
};

export default TodayOverview;
