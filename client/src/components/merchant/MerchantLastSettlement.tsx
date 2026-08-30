import React from 'react';
import { Banknote } from 'lucide-react';
import { toBsDateLabel, toNptTime } from '../../utils/nepaliDate';
import './MerchantLastSettlement.css';

interface MerchantLastSettlementProps {
  data: {
    lastAmount: number;
    lastSettledAt: string | null;
  };
  loading?: boolean;
}

const formatCurrency = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const formatSettledDate = (value: string | null) => {
  if (!value) return 'No settlements yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })}, ${toBsDateLabel(date)} · ${toNptTime(date)}`;
};

const MerchantLastSettlement: React.FC<MerchantLastSettlementProps> = ({ data, loading = false }) => (
  <div className="merchant-settlement-card">
    <div className="merchant-settlement-header">
      <Banknote size={20} style={{ color: 'var(--color-text-primary)' }} />
      <h3>Last Settlement</h3>
    </div>
    <div className="merchant-settlement-body">
      <div className="merchant-settlement-row">
        <span className="merchant-settlement-label">Amount Paid</span>
        <div className="merchant-settlement-value-stack">
          <span className="merchant-settlement-value">{loading ? '...' : formatCurrency(data.lastAmount)}</span>
          <span className="merchant-settlement-date">{loading ? '' : formatSettledDate(data.lastSettledAt)}</span>
        </div>
      </div>
    </div>
  </div>
);

export default MerchantLastSettlement;
