import React from 'react';
import { Link } from 'react-router-dom';
import { toBsDateLabel } from '../../utils/nepaliDate';
import './VendorTodayPanel.css';

interface VendorTodayPanelProps {
  orders: number;
  delivered: number;
  returns: number;
  remarks: number;
  loading?: boolean;
}

const VendorTodayPanel: React.FC<VendorTodayPanelProps> = ({
  orders,
  delivered,
  returns,
  remarks,
  loading = false,
}) => {
  const display = (v: number) => (loading ? '—' : v.toLocaleString());

  const dateLabel = toBsDateLabel(new Date());

  const rows: { label: string; value: string; tone: 'default' | 'success' | 'info' | 'warning'; to: string }[] = [
    { label: "Today's Orders",       value: display(orders),   tone: 'default', to: '/dashboard/metric/today-orders' },
    { label: "Today's Comments",     value: display(remarks),  tone: 'info',    to: '/remarks' },
    { label: "Today's RTV Delivered",value: display(returns),  tone: 'warning', to: '/dashboard/metric/today-returns' },
    { label: "Today's Delivered",    value: display(delivered),tone: 'success', to: '/dashboard/metric/today-delivered' },
  ];

  return (
    <div className="vendor-today-panel">
      <div className="vendor-today-panel-header">
        <span className="vendor-today-panel-title">Today's Details</span>
        <span className="vendor-today-panel-date">{dateLabel}</span>
      </div>
      <div className="vendor-today-panel-rows">
        {rows.map(({ label, value, tone, to }) => (
          <Link key={label} to={to} className="vendor-today-panel-row" title={`View ${label.toLowerCase()}`}>
            <span className="vendor-today-panel-label">{label}</span>
            <span className={`vendor-today-panel-value vendor-today-panel-value--${tone}`}>{value}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default VendorTodayPanel;
