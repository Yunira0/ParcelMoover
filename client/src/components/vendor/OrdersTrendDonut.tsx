import React from 'react';
import './OrdersTrendDonut.css';

interface OrdersTrendDonutProps {
  delivered: number;
  returns: number;
  loading?: boolean;
}

const OrdersTrendDonut: React.FC<OrdersTrendDonutProps> = ({ delivered, returns, loading = false }) => {
  const total = delivered + returns;
  const hasData = total > 0;
  const deliveredPercent = hasData ? Math.round((delivered / total) * 100) : 0;

  // With no delivered/returned orders yet, a delivered-vs-returned split has no
  // meaning - render a flat neutral ring instead of a solid-red (100% returned)
  // one, which reads as broken.
  const ringBackground = hasData
    ? `conic-gradient(var(--color-background-success-default) ${deliveredPercent}%, var(--color-danger-default) ${deliveredPercent}% 100%)`
    : 'var(--color-background-elevated)';

  return (
    <div className="orders-trend-donut">
      <h3 className="section-title">Orders Trend</h3>
      <div className="donut-ring" style={{ background: ringBackground }}>
        <div className="donut-center">
          <span>{loading ? '...' : hasData ? `${deliveredPercent}%` : '—'}</span>
        </div>
      </div>
      <div className="donut-legend">
        <div className="donut-legend-row">
          <span className="donut-dot donut-dot-delivered" />
          <span>Delivered</span>
          <span className="donut-legend-value">{loading ? '...' : delivered.toLocaleString()}</span>
        </div>
        <div className="donut-legend-row">
          <span className="donut-dot donut-dot-returned" />
          <span>Returned</span>
          <span className="donut-legend-value">{loading ? '...' : returns.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

export default OrdersTrendDonut;
