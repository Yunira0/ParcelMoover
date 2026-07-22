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

  // Each order row deep-links to the Orders page so a click lands on exactly the
  // orders behind that number. Two shapes, matching how each figure is counted:
  //  - Event-of-the-day figures (New orders, Delivered, Returned) are scoped to
  //    today. "New orders" keys off the created date; Delivered/Returned key off
  //    the Status Updated date (the delivery/return event), NOT the created date,
  //    so an order created earlier but delivered today is still included.
  //  - Snapshot figures (In transit, Pending deliveries, Pending returns) are
  //    all-time pipeline counts, so they carry no date filter - only the status.
  const createdToday = `dateFrom=${date}&dateTo=${date}`;
  const updatedToday = `dateField=lastUpdatedAt&dateFrom=${date}&dateTo=${date}`;

  const rows: ActivityRow[] = [
    { icon: ClipboardList, label: 'New orders', value: today.totalOrders, to: `/orders?${createdToday}` },
    { icon: Check, label: 'Delivered', value: today.delivered, to: `/orders?${updatedToday}&currentStatus=delivered&currentStatus=partially_delivered`, color: 'var(--color-success-default)' },
    { icon: Truck, label: 'In transit', value: today.inTransit, to: '/orders?currentStatus=dispatched&currentStatus=oov', color: 'var(--color-info-text)' },
    { icon: Package, label: 'Pending deliveries', value: overview.pendingDeliveries, to: '/orders?currentStatus=arrived_at_branch&currentStatus=ready_to_deliver&currentStatus=sent_for_delivery&currentStatus=failed_delivery', color: 'var(--color-background-warning-default)' },
    { icon: RotateCcw, label: 'Returned', value: today.returnedToVendor, to: `/orders?${updatedToday}&currentStatus=returned_to_vendor`, color: 'var(--color-danger-default)' },
    { icon: Undo2, label: 'Pending returns', value: overview.pendingReturns, to: '/orders?currentStatus=follow_up&currentStatus=ready_to_return&currentStatus=sent_to_vendor', color: 'var(--color-background-warning-default)' },
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
