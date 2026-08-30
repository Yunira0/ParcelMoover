import React from 'react';
import {
  ClipboardList,
  Clock,
  PackageCheck,
  RotateCcw,
  Undo2,
  PauseCircle,
  XCircle,
  Truck,
  BadgeCheck,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import { formatMoneyCompact } from '../../utils/format';
import {
  MERCHANT_METRIC_LABELS,
  MERCHANT_METRIC_ORDER,
  type MerchantMetricKey,
  type MerchantOverviewSummary,
} from '../../services/merchantOverview.service';
import './MerchantOverviewCards.css';

interface MerchantOverviewCardsProps {
  summary: MerchantOverviewSummary | null;
  loading?: boolean;
  activeKey?: MerchantMetricKey | null;
  onSelect?: (key: MerchantMetricKey | null) => void;
}

const CARD_CONFIG: Record<MerchantMetricKey, { icon: LucideIcon; color: string; bg: string }> = {
  totalOrders:      { icon: ClipboardList,   color: 'var(--color-primary)',          bg: 'var(--color-background-primary-subtle)' },
  pendingOrders:    { icon: Clock,            color: 'var(--color-background-warning-default)', bg: 'var(--color-warning-surface)' },
  totalDelivered:   { icon: PackageCheck,     color: 'var(--color-success-default)',  bg: 'var(--color-success-surface)' },
  returnProcessing: { icon: RotateCcw,        color: 'var(--color-danger-default)',   bg: 'var(--color-danger-surface)' },
  returnDelivered:  { icon: Undo2,            color: 'var(--color-info-text)',        bg: 'var(--color-info-surface)' },
  holdOrder:        { icon: PauseCircle,      color: 'var(--color-background-warning-default)', bg: 'var(--color-warning-surface)' },
  cancelledOrders:  { icon: XCircle,          color: 'var(--color-danger-default)',   bg: 'var(--color-danger-surface)' },
  deliveryCharge:   { icon: Truck,            color: 'var(--color-info-text)',        bg: 'var(--color-info-surface)' },
  deposited:        { icon: BadgeCheck,       color: 'var(--color-success-default)',  bg: 'var(--color-success-surface)' },
  pendingDeposit:   { icon: Landmark,         color: 'var(--color-danger-default)',   bg: 'var(--color-danger-surface)' },
};

const MerchantOverviewCards: React.FC<MerchantOverviewCardsProps> = ({ summary, loading = false, activeKey = null, onSelect }) => (
  <section className="vendor-cards-section" aria-label="Vendor overview totals">
    <div className="vendor-cards">
      {MERCHANT_METRIC_ORDER.map((key) => {
        const metric = summary?.metrics[key];
        const isActive = activeKey === key;
        const cfg = CARD_CONFIG[key];
        const Icon = cfg.icon;
        return (
          <button
            key={key}
            type="button"
            className={`vendor-card${isActive ? ' vendor-card-active' : ''}`}
            style={{ '--card-accent': cfg.color, '--card-bg': cfg.bg } as React.CSSProperties}
            onClick={() => onSelect?.(isActive ? null : key)}
            aria-pressed={isActive}
            aria-label={`${MERCHANT_METRIC_LABELS[key]}: ${loading || !metric ? 'loading' : metric.count}`}
          >
            <span className="vendor-card-top">
              <Icon size={16} style={{ color: cfg.color }} />
              <span className="vendor-card-label">{MERCHANT_METRIC_LABELS[key]}</span>
            </span>
            <span className="vendor-card-value">{loading || !metric ? '…' : metric.count.toLocaleString()}</span>
            {(!loading && metric) && <span className="vendor-card-hint">{formatMoneyCompact(metric.amount)}</span>}
          </button>
        );
      })}
    </div>
  </section>
);

export default MerchantOverviewCards;
