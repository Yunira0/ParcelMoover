import React from 'react';
import './OrdersTrendDonut.css';

interface OrdersTrendDonutProps {
  delivered: number;
  returns: number;
  loading?: boolean;
}

const OrdersTrendDonut: React.FC<OrdersTrendDonutProps> = ({ delivered, returns, loading = false }) => {
  const total = delivered + returns;
  const deliveredPercent = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return (
    <div className="orders-trend-donut">
      <h3 className="section-title">Orders Trend</h3>
      <div
        className="donut-ring"
        style={{ background: `conic-gradient(var(--color-background-success-default) ${deliveredPercent}%, #dc2626 ${deliveredPercent}% 100%)` }}
      >
        <div className="donut-center">
          <span>{loading ? '...' : `${deliveredPercent}%`}</span>
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
