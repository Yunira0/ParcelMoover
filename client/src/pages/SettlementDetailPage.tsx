import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Download, CreditCard, Pencil } from 'lucide-react';
import Button from '../components/Button';
import StatusChip from '../components/StatusChip';
import MakePaymentModal from '../components/MakePaymentModal';
import EditSettlementModal from '../components/EditSettlementModal';
import { getSettlementDetail, type SettlementDetail } from '../services/finance.service';
import { hasAnyRole, hasAdminPermission } from '../utils/auth';
import { toBsDate, toBsDateTime } from '../utils/nepaliDate';
import { downloadExcel } from '../utils/excel';
import './vendor/VendorFinance.css';
import './SettlementDetailPage.css';

const money = (value: number) => `Rs. ${value.toLocaleString()}`;

function buildStatementHtml(detail: SettlementDetail): string {
  const rows = detail.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>#${item.orderNumber}</td>
          <td>
            <div style="font-family:monospace">${item.trackingId}</div>
            ${item.deliveredAt ? `<div class="sub">${toBsDateTime(item.deliveredAt)}</div>` : ''}
            ${item.orderType ? `<div class="sub">${item.orderType}</div>` : ''}
          </td>
          <td>${item.receiverName}<div class="sub">${item.destination}</div></td>
          <td>${item.receiverPhone}</td>
          <td class="r">${item.weightKg === null ? '-' : item.weightKg.toFixed(2)}</td>
          <td class="r">${money(item.codAmount)}</td>
          <td class="r">${money(item.collectedAmount)}</td>
          <td class="r">${money(item.deliveryCharge)}</td>
          <td class="r">${money(item.settledAmount)}</td>
        </tr>`,
    )
    .join('');

  const totals = detail.items.reduce(
    (acc, item) => {
      acc.cod += item.codAmount;
      acc.collected += item.collectedAmount;
      acc.deliveryCharge += item.deliveryCharge;
      return acc;
    },
    { cod: 0, collected: 0, deliveryCharge: 0 },
  );

  return `<!doctype html><html><head><meta charset="utf-8"><title>${detail.statementId}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:32px;max-width:960px;margin:0 auto}
      h1{font-size:22px;margin:0 0 4px}
      .muted{color:#6b7280}
      .sub{color:#6b7280;font-size:11px}
      .head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:24px;margin-bottom:24px}
      .meta div{display:flex;justify-content:space-between;gap:24px;font-size:13px;min-width:240px}
      table{width:100%;border-collapse:collapse;margin-bottom:24px}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px}
      th{text-transform:uppercase;color:#6b7280;font-size:11px}
      .r{text-align:right}
      .totals{margin-left:auto;width:280px}
      .totals div{display:flex;justify-content:space-between;font-size:13px;padding:2px 0}
      .payable{font-weight:700;border-top:1px solid #e5e7eb;padding-top:6px;margin-top:6px}
    </style></head><body>
    <div class="head">
      <div>
        <div class="muted">BILL TO</div>
        <h1>${detail.payeeName}</h1>
        <div>${detail.payeePhone}</div>
        ${detail.payeeEmail ? `<div>${detail.payeeEmail}</div>` : ''}
        ${detail.payeeAddress ? `<div>${detail.payeeAddress}</div>` : ''}
      </div>
      <div class="meta">
        <div><span class="muted">Statement</span><span>${detail.statementId}</span></div>
        <div><span class="muted">Statement date</span><span>${detail.transferDate ? toBsDate(detail.transferDate) : '-'}</span></div>
        <div><span class="muted">Payment status</span><span>${detail.status === 'settled' ? 'Settled' : 'Pending'}</span></div>
        ${detail.remark ? `<div><span class="muted">Remark</span><span>${detail.remark}</span></div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr>
        <th>SN</th><th>Order ID</th><th>Transaction ID</th><th>Receiver</th><th>Number</th>
        <th class="r">Weight</th><th class="r">COD</th>
        <th class="r">Collected COD</th><th class="r">Delivery Charges</th>
        <th class="r">Net Payable</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Total COD</span><span>${money(totals.cod)}</span></div>
      <div><span>Collected COD</span><span>${money(totals.collected)}</span></div>
      <div><span>Delivery Charges</span><span>${money(totals.deliveryCharge)}</span></div>
      <div class="payable"><span>Payable Amount</span><span>${money(detail.payableAmount)}</span></div>
    </div>
  </body></html>`;
}

const SettlementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const canPay = hasAnyRole(['super_admin', 'admin']);
  // Correcting a mistake before money moves — gated by the delegable
  // EDIT_SETTLEMENTS permission, same pattern as MANAGE_USERS/SETTINGS_ACCESS.
  const canEdit = hasAnyRole(['super_admin']) || hasAdminPermission('EDIT_SETTLEMENTS');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getSettlementDetail(id)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load settlement detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const totals = detail
    ? detail.items.reduce(
        (acc, item) => {
          acc.cod += item.codAmount;
          acc.collected += item.collectedAmount;
          acc.deliveryCharge += item.deliveryCharge;
          return acc;
        },
        { cod: 0, collected: 0, deliveryCharge: 0 },
      )
    : { cod: 0, collected: 0, deliveryCharge: 0 };

  const handlePrint = () => {
    if (!detail) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildStatementHtml(detail));
    win.document.close();
    win.focus();
    win.print();
  };

  const handleDownload = () => {
    if (!detail) return;
    const headers = [
      'SN',
      'Order ID',
      'Transaction ID',
      'Receiver',
      'Receiver Phone',
      'Destination',
      'Weight',
      'COD',
      'Collected COD',
      'Delivery Charge',
    ];
    const rows = detail.items.map((item, index) => [
      index + 1,
      `#${item.orderNumber}`,
      item.trackingId,
      item.receiverName,
      item.receiverPhone,
      item.destination,
      item.weightKg === null ? '' : item.weightKg,
      item.codAmount,
      item.collectedAmount,
      item.deliveryCharge,
    ]);
    rows.push(['', '', '', '', '', '', '', totals.cod, totals.collected, totals.deliveryCharge]);
    downloadExcel(`${detail.statementId}.xlsx`, 'Statement', headers, rows);
  };

  return (
    <div className="settlement-detail-page">
      <div className="settlement-detail-toolbar">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="settlement-detail-actions">
          <Button variant="secondary" onClick={handlePrint} disabled={!detail}>
            <Printer size={16} /> Print
          </Button>
          <Button variant="secondary" onClick={handleDownload} disabled={!detail}>
            <Download size={16} /> Download
          </Button>
          {canEdit && detail?.status === 'pending' && (
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              <Pencil size={16} /> Edit
            </Button>
          )}
          {canPay && detail?.status === 'pending' && (
            <Button variant="primary" onClick={() => setShowPayment(true)}>
              <CreditCard size={16} /> Make Payment
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading statement...</div>
      ) : error ? (
        <p className="vendor-finance-error">{error}</p>
      ) : detail ? (
        <div className="cod-bill">
          <div className="cod-bill-header">
            <div className="cod-bill-billto">
              <div className="vendor-finance-subtext">BILL TO</div>
              <div className="cod-bill-vendor-name">{detail.payeeName}</div>
              <div>{detail.payeePhone}</div>
              {detail.payeeEmail && <div>{detail.payeeEmail}</div>}
              {detail.payeeAddress && <div>{detail.payeeAddress}</div>}
            </div>
            <div className="cod-bill-meta">
              <div>
                <span>Statement</span>
                <span style={{ fontFamily: 'monospace' }}>{detail.statementId}</span>
              </div>
              <div>
                <span>Statement date</span>
                <span>{detail.transferDate ? toBsDate(detail.transferDate) : '-'}</span>
              </div>
              <div>
                <span>Recorded</span>
                <span>{toBsDateTime(detail.createdAt) || '-'}</span>
              </div>
              <div>
                <span>Payment status</span>
                <StatusChip variant="solid" tone={detail.status === 'settled' ? 'success' : 'warning'}>
                  {detail.status === 'settled' ? 'Settled' : 'Pending'}
                </StatusChip>
              </div>
              {detail.status === 'settled' && detail.payments.length > 0 && (
                <div>
                  <span>Payment method</span>
                  <span>
                    {detail.payments
                      .map((p) => {
                        // Method names are configurable now; show them as
                        // stored, capitalising legacy lowercase values.
                        const label = p.method.charAt(0).toUpperCase() + p.method.slice(1);
                        return `${label}: Rs. ${p.amount.toLocaleString()}`;
                      })
                      .join(', ')}
                  </span>
                </div>
              )}
              {detail.remark && (
                <div>
                  <span>Remark</span>
                  <span>{detail.remark}</span>
                </div>
              )}
            </div>
          </div>

          {detail.items.length === 0 ? (
            <div className="loading-state">No orders linked to this settlement.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cod-bill-table">
                <thead>
                  <tr>
                    <th>SN</th>
                    <th>Order ID</th>
                    <th>Transaction ID</th>
                    <th>Receiver</th>
                    <th>Number</th>
                    <th style={{ textAlign: 'right' }}>Weight</th>
                    <th style={{ textAlign: 'right' }}>COD</th>
                    <th style={{ textAlign: 'right' }}>Collected COD</th>
                    <th style={{ textAlign: 'right' }}>Delivery Charges</th>
                    <th style={{ textAlign: 'right' }}>Net Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, index) => (
                    <tr key={item.trackingId}>
                      <td>{index + 1}</td>
                      <td>#{item.orderNumber}</td>
                      <td>
                        <div style={{ fontFamily: 'monospace' }}>{item.trackingId}</div>
                        {item.deliveredAt && (
                          <div className="vendor-finance-subtext">{toBsDateTime(item.deliveredAt)}</div>
                        )}
                        {item.orderType && <div className="vendor-finance-subtext">{item.orderType}</div>}
                      </td>
                      <td>
                        {item.receiverName}
                        <div className="vendor-finance-subtext">{item.destination}</div>
                      </td>
                      <td>{item.receiverPhone}</td>
                      <td style={{ textAlign: 'right' }}>
                        {item.weightKg === null ? '-' : item.weightKg.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(item.codAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{money(item.collectedAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{money(item.deliveryCharge)}</td>
                      <td style={{ textAlign: 'right' }}>{money(item.settledAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cod-bill-totals">
            <div>
              <span>Total COD</span>
              <span>{money(totals.cod)}</span>
            </div>
            <div>
              <span>Collected COD</span>
              <span>{money(totals.collected)}</span>
            </div>
            <div>
              <span>Delivery Charges</span>
              <span>{money(totals.deliveryCharge)}</span>
            </div>
            <div className="cod-bill-totals-payable">
              <span>Payable Amount</span>
              <span>{money(detail.payableAmount)}</span>
            </div>
          </div>
        </div>
      ) : null}

      {showPayment && detail && (
        <MakePaymentModal
          settlementId={detail.id}
          payableAmount={detail.payableAmount}
          onClose={() => setShowPayment(false)}
          onSuccess={() => setReloadKey((k) => k + 1)}
        />
      )}

      {showEdit && detail && (
        <EditSettlementModal
          settlementId={detail.id}
          payeeType={detail.payeeType}
          payeeId={detail.payeeId}
          currentItems={detail.items}
          onClose={() => setShowEdit(false)}
          onSuccess={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
};

export default SettlementDetailPage;
