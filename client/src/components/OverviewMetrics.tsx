import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, RotateCcw, Truck, Package, PackageCheck, TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import type { DashboardSummary } from '../services/orders.service';
import './OverviewMetrics.css';

export type MetricKey = 'pendingPickups' | 'pendingReturns' | 'inTransit' | 'pendingDeliveries' | 'deliveredToday';

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
  to: string;
}

// Flat metric strip (matches the dashboard concept): the pending pipeline plus
// today's deliveries, each linking to the screen where that number is worked.
const OverviewMetrics: React.FC<OverviewMetricsProps> = ({ overview, today, loading = false, deltas }) => {
  const metrics: Metric[] = [
    { key: 'pendingPickups', icon: ClipboardList, color: 'var(--color-primary)', label: 'Pending pickups', value: overview.pendingPickups, to: '/orders?tab=ready_to_pick' },
    { key: 'pendingReturns', icon: RotateCcw, color: 'var(--color-danger-default)', label: 'Pending returns', value: overview.pendingReturns, to: '/return' },
    { key: 'inTransit', icon: Truck, color: 'var(--color-info-text)', label: 'In transit', value: overview.inTransit, to: '/orders?tab=inprogress' },
    { key: 'pendingDeliveries', icon: Package, color: 'var(--color-background-warning-default)', label: 'Pending deliveries', value: overview.pendingDeliveries, to: '/orders?tab=inprogress&currentStatus=arrived_at_branch&currentStatus=ready_to_deliver&currentStatus=sent_for_delivery&currentStatus=failed_delivery' },
    { key: 'deliveredToday', icon: PackageCheck, color: 'var(--color-success-default)', label: 'Delivered today', value: today.delivered, to: '/orders?tab=delivered' },
  ];

  return (
    <div className="overview-metrics">
      {metrics.map(({ key, icon: Icon, color, label, value, to }) => {
        const delta = deltas?.[key];
        const hasDelta = !loading && delta !== undefined && delta !== null;
        const up = (delta ?? 0) >= 0;
        return (
          <Link key={key} to={to} className="overview-metric" aria-label={`${label}: ${loading ? 'loading' : value} — view details`}>
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
