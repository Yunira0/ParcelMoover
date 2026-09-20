import React from 'react';
import { Link } from 'react-router-dom';
import {
  Package, Truck, RotateCcw,
  PackageSearch, Clock, RefreshCw, Route,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../../utils/format';
import './VendorOverviewCards.css';

interface VendorOverviewCardsProps {
  totalOrders: number;
  totalOrderAmount: number;
  delivered: number;
  deliveredAmount: number;
  rtvDelivered: number;
  rtvDeliveredAmount: number;
  inTransit: number;
  inTransitAmount: number;
  inProgress: number;
  inProgressAmount: number;
  pendingPickup: number;
  pendingPickupAmount: number;
  returnProcess: number;
  returnProcessAmount: number;
  loading?: boolean;
}

interface MetricCard {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  /** Metric drill-down page for this card (see VendorMetricDetail's METRICS). */
  to: string;
}

const VendorOverviewCards: React.FC<VendorOverviewCardsProps> = ({
  totalOrders,
  totalOrderAmount,
  delivered,
  deliveredAmount,
  rtvDelivered,
  rtvDeliveredAmount,
  inTransit,
  inTransitAmount,
  inProgress,
  inProgressAmount,
  pendingPickup,
  pendingPickupAmount,
  returnProcess,
  returnProcessAmount,
  loading = false,
}) => {
  const fmt = (v: number) => (loading ? '—' : v.toLocaleString());
  const fmtAmount = (v: number) => (loading ? undefined : formatCurrency(v ?? 0));

  const cards: MetricCard[] = [
    { icon: Package,       label: 'Total Orders',  value: fmt(totalOrders),  sub: fmtAmount(totalOrderAmount),    accent: 'primary', to: '/dashboard/metric/total-orders' },
    { icon: Truck,         label: 'Delivered',     value: fmt(delivered),    sub: fmtAmount(deliveredAmount),     accent: 'success', to: '/dashboard/metric/delivered' },
    { icon: RotateCcw,     label: 'RTV Delivered', value: fmt(rtvDelivered), sub: fmtAmount(rtvDeliveredAmount),  accent: 'warning', to: '/dashboard/metric/rtv-delivered' },
    // Transit only: parcels moving between hubs (Transit/oov) or out on a
    // dispatch (In Transit/dispatched). Deliberately NOT the whole
    // picked-up-to-doorstep span - that is the in-delivery bucket this card
    // used to count, which made "In Transit" open onto parcels still sitting
    // at a hub or already out for delivery.
    { icon: PackageSearch, label: 'In Transit',    value: fmt(inTransit),    sub: fmtAmount(inTransitAmount),     accent: 'info',    to: '/dashboard/metric/in-transit' },
    // The wider bucket In Transit deliberately excludes: everything from pickup
    // to the doorstep, including parcels resting at a hub or already out for
    // delivery. Opens the in-delivery drill-down, which is labelled In Process.
    { icon: Route,         label: 'In Process',   value: fmt(inProgress),   sub: fmtAmount(inProgressAmount),    accent: 'progress', to: '/dashboard/metric/in-delivery' },
    { icon: Clock,         label: 'Pending Pickup',value: fmt(pendingPickup),  sub: fmtAmount(pendingPickupAmount),   accent: 'neutral', to: '/dashboard/metric/pending-pickup' },
    { icon: RefreshCw,     label: 'Return Process',value: fmt(returnProcess),sub: fmtAmount(returnProcessAmount), accent: 'danger',  to: '/dashboard/metric/return-process' },
  ];

  return (
    <div className="vendor-overview-cards">
      {cards.map(({ icon: Icon, label, value, sub, accent, to }) => (
        <Link key={label} to={to} className="vendor-metric-card" title={`View ${label.toLowerCase()} orders`}>
          <div className={`vendor-metric-icon vendor-metric-icon--${accent}`}>
            <Icon size={18} />
          </div>
          <div className="vendor-metric-body">
            <span className="vendor-metric-value">{value}</span>
            <span className="vendor-metric-label">{label}</span>
            {sub && <span className="vendor-metric-sub">{sub}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
};

export default VendorOverviewCards;
