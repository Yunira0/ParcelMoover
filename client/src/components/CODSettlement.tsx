import React from 'react';
import { Banknote } from 'lucide-react';
import type { DashboardSummary } from '../services/orders.service';
import './CODSettlement.css';

interface CODSettlementProps {
  data: DashboardSummary['codSettlement'];
  loading?: boolean;
}

const formatCurrency = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const CODSettlement: React.FC<CODSettlementProps> = ({ data, loading = false }) => {
  const percent = Math.max(0, Math.min(100, Math.round(data.progressPercent)));
  const offset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div className="cod-settlement">
      <div className="cod-header">
        <Banknote size={20} style={{ color: 'var(--color-background-primary-default)' }} />
        <h3>COD SETTLEMENT</h3>
      </div>

      <div className="cod-ring-wrap">
        <svg className="cod-ring" viewBox="0 0 120 120" role="img" aria-label={`${percent}% of COD settled`}>
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
          <text className="cod-ring-percent" x="60" y="58" textAnchor="middle">{loading ? '—' : `${percent}%`}</text>
          <text className="cod-ring-caption" x="60" y="76" textAnchor="middle">settled</text>
        </svg>
      </div>

      <div className="settlement-details">
        <div className="settlement-row">
          <div className="status-label">
            <span className="status-dot total"></span>
            <span>Total COD</span>
          </div>
          <span className="status-amount">{loading ? '...' : formatCurrency(data.totalCod)}</span>
        </div>
        <div className="settlement-row">
          <div className="status-label">
            <span className="status-dot settled"></span>
            <span>Settled COD</span>
          </div>
          <span className="status-amount">{loading ? '...' : formatCurrency(data.settledCod)}</span>
        </div>
        <div className="settlement-row">
          <div className="status-label">
            <span className="status-dot pending"></span>
            <span>Pending</span>
          </div>
          <span className="status-amount cod-pending">{loading ? '...' : formatCurrency(data.pendingCod)}</span>
        </div>
        <div className="settlement-row">
          <div className="status-label">
            <span className="status-dot rider"></span>
            <span>COD to collect from riders</span>
          </div>
          <span className="status-amount">{loading ? '...' : formatCurrency(data.codFromRider)}</span>
        </div>
        <div className="settlement-row">
          <div className="status-label">
            <span className="status-dot delivery"></span>
            <span>Delivery charge</span>
          </div>
          <span className="status-amount">{loading ? '...' : formatCurrency(data.deliveryCharge)}</span>
        </div>
      </div>
    </div>
  );
};

export default CODSettlement;
