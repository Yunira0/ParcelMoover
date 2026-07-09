import React from 'react';
import { Banknote } from 'lucide-react';
import type { DashboardSummary } from '../services/orders.service';
import './CODSettlement.css';

interface CODSettlementProps {
  data: DashboardSummary['codSettlement'];
  loading?: boolean;
}

const formatCurrency = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

const CODSettlement: React.FC<CODSettlementProps> = ({ data, loading = false }) => {
  const progressPercent = Math.min(Math.max(data.progressPercent, 0), 100);
  const displayProgress = `${progressPercent.toFixed(1)}%`;

  return (
    <div className="cod-settlement">
      <div className="cod-header">
        <Banknote size={24} style={{ color: 'var(--color-background-primary-default)' }} />
        <h3>COD SETTLEMENT</h3>
      </div>
      
      <div className="total-collection">
        <span>Total COD</span>
        <span className="total-amount">{loading ? '...' : formatCurrency(data.totalCod)}</span>
      </div>
      
      <div className="settlement-details">
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
          <span className="status-amount">{loading ? '...' : formatCurrency(data.pendingCod)}</span>
        </div>
      </div>
      
      <div className="settlement-progress">
        <div className="progress-header">
          <span>Settlement Progress</span>
          <span className="progress-percent">{loading ? '...' : displayProgress}</span>
        </div>
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: loading ? '0%' : displayProgress }}></div>
        </div>
      </div>
    </div>
  );
};

export default CODSettlement;
