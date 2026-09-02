import React from 'react';
import {
  ClipboardList,
  Truck,
  Package,
  PackageCheck,
  RotateCcw,
  Undo2,
  PauseCircle,
  AlertTriangle,
  BadgeCheck,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import {
  BRANCH_METRIC_LABELS,
  BRANCH_METRIC_ORDER,
  type BranchMetricKey,
} from '../../services/branchTracking.service';
import '../merchant/MerchantOverviewCards.css';

interface BranchOverviewCardsProps {
  /** Per-card counts once wired; missing keys render "—". */
  counts?: Partial<Record<BranchMetricKey, number>>;
  loading?: boolean;
  activeKey?: BranchMetricKey | null;
  onSelect?: (key: BranchMetricKey | null) => void;
}

const CARD_CONFIG: Record<BranchMetricKey, { icon: LucideIcon; color: string }> = {
  totalOrders:      { icon: ClipboardList, color: 'var(--color-primary)' },
  inTransit:        { icon: Truck,         color: 'var(--color-info-text)' },
  pendingDelivery:  { icon: Package,       color: 'var(--color-background-warning-default)' },
  totalDelivered:   { icon: PackageCheck,  color: 'var(--color-success-default)' },
  returnProcessing: { icon: RotateCcw,     color: 'var(--color-danger-default)' },
  returned:         { icon: Undo2,         color: 'var(--color-info-text)' },
  hold:             { icon: PauseCircle,   color: 'var(--color-background-warning-default)' },
  failed:           { icon: AlertTriangle, color: 'var(--color-danger-default)' },
  deposited:        { icon: BadgeCheck,    color: 'var(--color-success-default)' },
  pendingDeposit:   { icon: Landmark,      color: 'var(--color-danger-default)' },
};

// Same card strip as Vendor Overview's MerchantOverviewCards — icon + label,
// a big count, click to filter the table. Counts are "—" until a hub-scoped
// summary endpoint lands.
const BranchOverviewCards: React.FC<BranchOverviewCardsProps> = ({
  counts,
  loading = false,
  activeKey = null,
  onSelect,
}) => (
  <section className="vendor-cards-section" aria-label="Branch overview totals">
    <div className="vendor-cards">
      {BRANCH_METRIC_ORDER.map((key) => {
        const isActive = activeKey === key;
        const cfg = CARD_CONFIG[key];
        const Icon = cfg.icon;
        const count = counts?.[key];
        return (
          <button
            key={key}
            type="button"
            className={`vendor-card${isActive ? ' vendor-card-active' : ''}`}
            onClick={() => onSelect?.(isActive ? null : key)}
            aria-pressed={isActive}
            aria-label={`${BRANCH_METRIC_LABELS[key]}: ${
              loading ? 'loading' : count ?? 'not available'
            }`}
          >
            <span className="vendor-card-top">
              <Icon size={16} style={{ color: cfg.color }} />
              <span className="vendor-card-label">{BRANCH_METRIC_LABELS[key]}</span>
            </span>
            <span className="vendor-card-value">
              {loading ? '…' : count === undefined ? '—' : count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  </section>
);

export default BranchOverviewCards;
