import React from 'react';
import {
  Package, Truck, RotateCcw,
  PackageSearch, PauseCircle, RefreshCw,
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
  inDelivery: number;
  inDeliveryAmount: number;
  holdOrders: number;
  holdOrdersAmount: number;
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
}

const VendorOverviewCards: React.FC<VendorOverviewCardsProps> = ({
  totalOrders,
  totalOrderAmount,
  delivered,
  deliveredAmount,
  rtvDelivered,
  rtvDeliveredAmount,
  inDelivery,
  inDeliveryAmount,
  holdOrders,
  holdOrdersAmount,
  returnProcess,
  returnProcessAmount,
  loading = false,
}) => {
  const fmt = (v: number) => (loading ? '—' : v.toLocaleString());
  const fmtAmount = (v: number) => (loading ? undefined : formatCurrency(v ?? 0));

  const cards: MetricCard[] = [
    { icon: Package,       label: 'Total Orders',  value: fmt(totalOrders),  sub: fmtAmount(totalOrderAmount),    accent: 'primary'  },
    { icon: Truck,         label: 'Delivered',     value: fmt(delivered),    sub: fmtAmount(deliveredAmount),     accent: 'success'  },
    { icon: RotateCcw,     label: 'RTV Delivered', value: fmt(rtvDelivered), sub: fmtAmount(rtvDeliveredAmount),  accent: 'warning'  },
    { icon: PackageSearch, label: 'In Delivery',   value: fmt(inDelivery),   sub: fmtAmount(inDeliveryAmount),    accent: 'info'     },
    { icon: PauseCircle,   label: 'Hold Orders',   value: fmt(holdOrders),   sub: fmtAmount(holdOrdersAmount),    accent: 'neutral'  },
    { icon: RefreshCw,     label: 'Return Process',value: fmt(returnProcess),sub: fmtAmount(returnProcessAmount), accent: 'danger'   },
  ];

  return (
    <div className="vendor-overview-cards">
      {cards.map(({ icon: Icon, label, value, sub, accent }) => (
        <div key={label} className="vendor-metric-card">
          <div className={`vendor-metric-icon vendor-metric-icon--${accent}`}>
            <Icon size={18} />
          </div>
          <div className="vendor-metric-body">
            <span className="vendor-metric-value">{value}</span>
            <span className="vendor-metric-label">{label}</span>
            {sub && <span className="vendor-metric-sub">{sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorOverviewCards;
