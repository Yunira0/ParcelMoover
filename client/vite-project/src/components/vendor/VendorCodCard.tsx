import React from 'react';
import { Banknote } from 'lucide-react';
import type { DashboardSummary } from '../../services/orders.service';
import './VendorCodCard.css';

interface VendorCodCardProps {
  data: DashboardSummary['codSettlement'];
  loading?: boolean;
}

const formatCurrency = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const formatSettledDate = (value: string | null) => {
  if (!value) return 'No settlements yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const VendorCodCard: React.FC<VendorCodCardProps> = ({ data, loading = false }) => (
  <div className="vendor-cod-card">
    <div className="vendor-cod-card-header">
      <Banknote size={32} style={{ color: 'var(--color-text-primary)' }} />
      <h3>COD</h3>
    </div>
    <div className="vendor-cod-card-body">
      <div className="vendor-cod-card-rows">
        <div className="vendor-cod-card-row">
          <span className="vendor-cod-card-row-label">Last Cod Amount</span>
          <div className="vendor-cod-card-row-value-stack">
            <span className="vendor-cod-card-row-value">{loading ? '...' : formatCurrency(data.lastAmount)}</span>
            <span className="vendor-cod-card-row-date">{loading ? '' : formatSettledDate(data.lastSettledAt)}</span>
          </div>
        </div>
        <div className="vendor-cod-card-row">
          <span className="vendor-cod-card-row-label">Pending</span>
          <span className="vendor-cod-card-row-value">{loading ? '...' : formatCurrency(data.pendingCod)}</span>
        </div>
      </div>
      <div className="vendor-cod-card-total">
        <span>Total</span>
        <span className="vendor-cod-card-total-value">{loading ? '...' : formatCurrency(data.totalCod)}</span>
      </div>
    </div>
  </div>
);

export default VendorCodCard;
