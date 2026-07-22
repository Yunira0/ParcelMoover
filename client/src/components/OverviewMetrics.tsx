import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, RotateCcw, Truck, Package, PackageCheck, TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import type { DashboardSummary, ParcelStatus } from '../services/orders.service';
import './OverviewMetrics.css';

export type MetricKey = 'pendingPickups' | 'pendingReturns' | 'inTransit' | 'pendingDeliveries' | 'deliveredToday';

// The parcel statuses each overview card counts. Shared with the drill-down and
// the Excel export so the card number, the table below it, and the download all
// describe the exact same set. Kept in step with the server-side groupings in
// order.service.ts (PICKUP_PENDING_STATUSES, RETURN_PENDING_STATUSES,
// IN_TRANSIT_STATUSES, DELIVERY_PENDING_STATUSES).
export interface MetricStatusGroup {
  label: string;
  statuses: ParcelStatus[];
  /** deliveredToday counts only orders delivered today - filtered by deliveredAt. */
  todayOnly?: boolean;
}

export const METRIC_STATUS_GROUPS: Record<MetricKey, MetricStatusGroup> = {
  pendingPickups: { label: 'Pending pickups', statuses: ['pickup_ordered', 'rider_assigned', 'picked_up', 'arrived'] },
  pendingReturns: { label: 'Pending returns', statuses: ['follow_up', 'ready_to_return', 'sent_to_vendor'] },
  inTransit: { label: 'In transit', statuses: ['dispatched', 'oov'] },
  pendingDeliveries: { label: 'Pending deliveries', statuses: ['arrived_at_branch', 'ready_to_deliver', 'sent_for_delivery', 'failed_delivery'] },
  deliveredToday: { label: 'Delivered today', statuses: ['delivered', 'partially_delivered'], todayOnly: true },
};

interface OverviewMetricsProps {
  overview: DashboardSummary['overview'];
  today: DashboardSummary['today'];
  loading?: boolean;
  /** Percent change vs the previous period, per metric. Omitted keys show no
   *  delta (used while the backend period-over-period field is unavailable). */
  deltas?: Partial<Record<MetricKey, number | null>>;
}

interface Metric {
  key: MetricKey;
  icon: LucideIcon;
  color: string;
  label: string;
  value: number;
}

// Flat metric strip (matches the dashboard concept): the pending pipeline plus
// today's deliveries. Each card links to its own page listing the exact orders
// it counts (with an Excel export).
const OverviewMetrics: React.FC<OverviewMetricsProps> = ({ overview, today, loading = false, deltas }) => {
  const metrics: Metric[] = [
    { key: 'pendingPickups', icon: ClipboardList, color: 'var(--color-primary)', label: 'Pending pickups', value: overview.pendingPickups },
    { key: 'pendingReturns', icon: RotateCcw, color: 'var(--color-danger-default)', label: 'Pending returns', value: overview.pendingReturns },
    { key: 'inTransit', icon: Truck, color: 'var(--color-info-text)', label: 'In transit', value: overview.inTransit },
    { key: 'pendingDeliveries', icon: Package, color: 'var(--color-background-warning-default)', label: 'Pending deliveries', value: overview.pendingDeliveries },
    { key: 'deliveredToday', icon: PackageCheck, color: 'var(--color-success-default)', label: 'Delivered today', value: today.delivered },
  ];

  return (
    <div className="overview-metrics">
      {metrics.map(({ key, icon: Icon, color, label, value }) => {
        const delta = deltas?.[key];
        const hasDelta = !loading && delta !== undefined && delta !== null;
        const up = (delta ?? 0) >= 0;
        return (
          <Link
            key={key}
            to={`/overview/${key}`}
            className="overview-metric"
            aria-label={`${label}: ${loading ? 'loading' : value} — view orders`}
          >
            <span className="overview-metric-top">
              <Icon size={16} style={{ color }} />
              <span className="overview-metric-label">{label}</span>
            </span>
            <span className="overview-metric-value">{loading ? '…' : value.toLocaleString()}</span>
            {hasDelta && (
              <span className={`overview-metric-delta ${up ? 'is-up' : 'is-down'}`}>
                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {Math.abs(delta as number)}% {key === 'deliveredToday' ? 'vs yesterday' : 'vs last period'}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
};

export default OverviewMetrics;
