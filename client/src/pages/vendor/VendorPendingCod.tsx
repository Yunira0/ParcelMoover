import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import type { PendingCodBill } from '../../services/finance.service';
import { getPendingCod } from '../../services/finance.service';
import { formatCurrency } from '../../utils/format';
import { toBsDate } from '../../utils/nepaliDate';
import './VendorFinance.css';

// The whole bill arrives in one response, so the rows are paged client-side —
// the totals below always cover every order, not just the visible page.
const PAGE_SIZE = 20;

const VendorPendingCod: React.FC = () => {
  const [bill, setBill] = useState<PendingCodBill | null>(null);
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
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

  const items = bill?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSizeChoice));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = items.slice((currentPage - 1) * pageSizeChoice, currentPage * pageSizeChoice);

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
                <span>{toBsDate(bill.statementDate)}</span>
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
                <th>Order ID</th>
                <th>Tracking ID</th>
                <th>Customer</th>
                <th>COD</th>
                <th>Delivery Charges</th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((item, index) => (
                <tr key={item.trackingId}>
                  <td>{(currentPage - 1) * pageSizeChoice + index + 1}</td>
                  <td>#{item.orderNumber}</td>
                  <td>{item.trackingId}</td>
                  <td>
                    {item.receiverName}
                    <div className="vendor-finance-subtext">{item.receiverPhone}</div>
                    <div className="vendor-finance-subtext">{item.destination}</div>
                  </td>
                  <td>{formatCurrency(item.codAmount)}</td>
                  <td>{formatCurrency(item.deliveryCharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination
            ariaLabel="Pending COD pagination"
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSizeChoice}
            pageSizeLabel="orders"
            onPageSizeChange={(size) => {
              setPageSizeChoice(size);
              setPage(1);
            }}
            summary={`Showing ${(currentPage - 1) * pageSizeChoice + 1}–${Math.min(
              currentPage * pageSizeChoice,
              items.length,
            )} of ${items.length} order${items.length === 1 ? '' : 's'}`}
          />

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
