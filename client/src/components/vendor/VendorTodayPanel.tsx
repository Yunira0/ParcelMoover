import React from 'react';
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

  const rows: { label: string; value: string; tone: 'default' | 'success' | 'info' | 'warning' }[] = [
    { label: "Today's Orders",       value: display(orders),   tone: 'default' },
    { label: "Today's Comments",     value: display(remarks),  tone: 'info'    },
    { label: "Today's RTV Delivered",value: display(returns),  tone: 'warning' },
    { label: "Today's Delivered",    value: display(delivered),tone: 'success' },
  ];

  return (
    <div className="vendor-today-panel">
      <div className="vendor-today-panel-header">
        <span className="vendor-today-panel-title">Today's Details</span>
        <span className="vendor-today-panel-date">{dateLabel}</span>
      </div>
      <div className="vendor-today-panel-rows">
        {rows.map(({ label, value, tone }) => (
          <div key={label} className="vendor-today-panel-row">
            <span className="vendor-today-panel-label">{label}</span>
            <span className={`vendor-today-panel-value vendor-today-panel-value--${tone}`}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorTodayPanel;
