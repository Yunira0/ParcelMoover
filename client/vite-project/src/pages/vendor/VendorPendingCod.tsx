import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import type { PendingCodBill } from '../../services/finance.service';
import { getPendingCod } from '../../services/finance.service';
import { formatCurrency } from '../../utils/format';
import './VendorFinance.css';

const VendorPendingCod: React.FC = () => {
  const [bill, setBill] = useState<PendingCodBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getPendingCod()
      .then((data) => {
        if (active) setBill(data);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load pending COD.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="vendor-finance-page">
      <PageHeader
        title="Pending COD Orders"
        subtitle="Manage and track your package orders within the pending cash on delivery network."
      />

      {loading ? (
        <div className="loading-state">Loading pending COD...</div>
      ) : error ? (
        <p className="vendor-finance-error">{error}</p>
      ) : !bill || bill.items.length === 0 ? (
        <div className="loading-state">No pending COD orders.</div>
      ) : (
        <div className="cod-bill">
          <div className="cod-bill-header">
            <div className="cod-bill-billto">
              <div className="vendor-finance-subtext">BILL TO</div>
              <div className="cod-bill-vendor-name">{bill.vendor.name}</div>
              <div>{bill.vendor.phone}</div>
              {bill.vendor.email && <div>{bill.vendor.email}</div>}
              {bill.vendor.address && <div>{bill.vendor.address}</div>}
            </div>
            <div className="cod-bill-meta">
              <div>
                <span>Statement date</span>
                <span>{new Date(bill.statementDate).toLocaleDateString()}</span>
              </div>
              <div>
                <span>Payment status</span>
                <span>Pending</span>
              </div>
            </div>
          </div>

          <table className="cod-bill-table">
            <thead>
              <tr>
                <th>SN</th>
                <th>Tracking ID</th>
                <th>Receiver</th>
                <th>Destination</th>
                <th>COD</th>
                <th>Charges</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item, index) => (
                <tr key={item.trackingId}>
                  <td>{index + 1}</td>
                  <td>{item.trackingId}</td>
                  <td>
                    {item.receiverName}
                    <div className="vendor-finance-subtext">{item.receiverPhone}</div>
                  </td>
                  <td>{item.destination}</td>
                  <td>{formatCurrency(item.codAmount)}</td>
                  <td>{formatCurrency(item.deliveryCharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="cod-bill-totals">
            <div>
              <span>Total COD</span>
              <span>{formatCurrency(bill.totals.totalCod)}</span>
            </div>
            <div>
              <span>Delivery charges</span>
              <span>{formatCurrency(bill.totals.deliveryCharges)}</span>
            </div>
            <div className="cod-bill-totals-payable">
              <span>Payable Amount</span>
              <span>{formatCurrency(bill.totals.payableAmount)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorPendingCod;
