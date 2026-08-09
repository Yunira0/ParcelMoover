import React from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ChevronRight } from 'lucide-react';
import type { CodDetailBucket, DashboardSummary } from '../services/orders.service';
import { COD_BUCKET_META, codBucketPath } from '../utils/codBuckets';
import './CODSettlement.css';

interface CODSettlementProps {
  data: DashboardSummary['codSettlement'];
  loading?: boolean;
}

const formatCurrency = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Every figure on this card is the sum of a set of orders, so every figure
// drills down to those orders. `dot` is the swatch class; `bucket` picks both
// the label (from the shared meta) and the detail page it opens.
const RowLink: React.FC<{
  bucket: CodDetailBucket;
  dot: string;
  amount: number;
  loading: boolean;
  amountClassName?: string;
  nested?: boolean;
}> = ({ bucket, dot, amount, loading, amountClassName, nested = false }) => (
  <Link
    to={codBucketPath(bucket)}
    className={nested ? 'settlement-subrow' : 'settlement-row'}
    aria-label={`${COD_BUCKET_META[bucket].label}: view orders`}
  >
    <div className="status-label">
      <span className={`status-dot ${dot}`}></span>
      <span>{COD_BUCKET_META[bucket].label}</span>
    </div>
    <span className="settlement-row-value">
      <span className={`status-amount ${amountClassName ?? ''}`.trim()}>
        {loading ? '...' : formatCurrency(amount)}
      </span>
      <ChevronRight className="settlement-row-chevron" size={14} aria-hidden="true" />
    </span>
  </Link>
);

const CODSettlement: React.FC<CODSettlementProps> = ({ data, loading = false }) => {
  const percent = Math.max(0, Math.min(100, Math.round(data.progressPercent)));
  const offset = CIRCUMFERENCE * (1 - percent / 100);
  // Rounding a genuine sliver of progress (e.g. 0.35%) down to a whole
  // percent reads as "nothing settled" even though real money moved - and
  // the same trap applies in reverse just under 100%. Only the label needs
  // the escape hatch; the ring's fill already uses the unrounded percent.
  const percentLabel =
    percent === 0 && data.settledCod > 0
      ? "<1%"
      : percent === 100 && data.pendingCod > 0
        ? ">99%"
        : `${percent}%`;

  return (
    <div className="cod-settlement">
      <div className="cod-header">
        <Banknote size={20} style={{ color: 'var(--color-background-primary-default)' }} />
        <h3>COD SETTLEMENT</h3>
      </div>

      <div className="cod-ring-wrap">
        <svg className="cod-ring" viewBox="0 0 120 120" role="img" aria-label={`${percentLabel} of COD settled`}>
          <circle className="cod-ring-track" cx="60" cy="60" r={RADIUS} />
          <circle
            className="cod-ring-value"
            cx="60"
            cy="60"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={loading ? CIRCUMFERENCE : offset}
            transform="rotate(-90 60 60)"
          />
          <text className="cod-ring-percent" x="60" y="58" textAnchor="middle">{loading ? '—' : percentLabel}</text>
          <text className="cod-ring-caption" x="60" y="76" textAnchor="middle">settled</text>
        </svg>
      </div>

      <div className="settlement-details">
        <RowLink bucket="total" dot="total" amount={data.totalCod} loading={loading} />
        <RowLink bucket="settled" dot="settled" amount={data.settledCod} loading={loading} />
        <RowLink
          bucket="pending"
          dot="pending"
          amount={data.pendingCod}
          loading={loading}
          amountClassName="cod-pending"
        />

        {/* Umbrella heading, not a metric of its own: its figure is exactly the
            sum of the carriers nested beneath it, so there's no separate set of
            orders to drill into - each carrier owns its own. Future 3PLs slot
            in here alongside NCM. */}
        <div className="settlement-row settlement-row--heading">
          <div className="status-label">
            <span className="status-dot rider"></span>
            <span>COD to collect from riders</span>
          </div>
          <span className="status-amount">{loading ? '...' : formatCurrency(data.codFromRiders)}</span>
        </div>
        <RowLink bucket="pm-rider" dot="pm-rider" amount={data.codFromPmRider} loading={loading} nested />
        <RowLink bucket="ncm" dot="ncm" amount={data.codFromNcm} loading={loading} nested />
        <RowLink bucket="upaya" dot="upaya" amount={data.codFromUpaya} loading={loading} nested />

        <RowLink
          bucket="delivery-charge"
          dot="delivery"
          amount={data.deliveryCharge}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default CODSettlement;
