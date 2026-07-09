import React from 'react';
import {
  Package, Truck, RotateCcw,
  PackageSearch, PauseCircle, RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './VendorOverviewCards.css';

interface VendorOverviewCardsProps {
  totalOrders: number;
  delivered: number;
  rtvDelivered: number;
  inDelivery: number;
  holdOrders: number;
  returnProcess: number;
  loading?: boolean;
}

interface MetricCard {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
}

const VendorOverviewCards: React.FC<VendorOverviewCardsProps> = ({
  totalOrders,
  delivered,
  rtvDelivered,
  inDelivery,
  holdOrders,
  returnProcess,
  loading = false,
}) => {
  const fmt = (v: number) => (loading ? '—' : v.toLocaleString());

  const cards: MetricCard[] = [
    { icon: Package,       label: 'Total Orders',  value: fmt(totalOrders),  accent: 'primary'  },
    { icon: Truck,         label: 'Delivered',     value: fmt(delivered),    accent: 'success'  },
    { icon: RotateCcw,     label: 'RTV Delivered', value: fmt(rtvDelivered), accent: 'warning'  },
    { icon: PackageSearch, label: 'In Delivery',   value: fmt(inDelivery),   accent: 'info'     },
    { icon: PauseCircle,   label: 'Hold Orders',   value: fmt(holdOrders),   accent: 'neutral'  },
    { icon: RefreshCw,     label: 'Return Process',value: fmt(returnProcess),accent: 'danger'   },
  ];

  return (
    <div className="vendor-overview-cards">
      {cards.map(({ icon: Icon, label, value, accent }) => (
        <div key={label} className="vendor-metric-card">
          <div className={`vendor-metric-icon vendor-metric-icon--${accent}`}>
            <Icon size={18} />
          </div>
          <div className="vendor-metric-body">
            <span className="vendor-metric-value">{value}</span>
            <span className="vendor-metric-label">{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorOverviewCards;
