import React from 'react';
import './VendorOverviewStrip.css';

interface VendorOverviewStripProps {
  orders: number;
  delivered: number;
  returns: number;
  remarks: number;
  unclosedComments: number;
  loading?: boolean;
}

const VendorOverviewStrip: React.FC<VendorOverviewStripProps> = ({
  orders,
  delivered,
  returns,
  remarks,
  unclosedComments,
  loading = false,
}) => {
  const display = (value: number) => (loading ? '...' : value.toLocaleString());

  const items = [
    { label: 'Orders', value: display(orders) },
    { label: 'Delivered', value: display(delivered) },
    { label: 'Return', value: display(returns) },
    { label: 'Remarks', value: display(remarks) },
    { label: 'Unclosed Comments', value: display(unclosedComments) },
  ];

  return (
    <div className="vendor-overview-strip">
      <h2 className="section-title">Today's Overview</h2>
      <div className="vendor-overview-strip-row">
        {items.map((item) => (
          <div className="vendor-overview-strip-item" key={item.label}>
            <span className="vendor-overview-strip-label">{item.label}</span>
            <span className="vendor-overview-strip-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorOverviewStrip;
