import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CreditCard, Pencil } from 'lucide-react';
import Button from '../../components/Button';
import StatusChip from '../../components/StatusChip';
import ConfirmBanner from '../../components/ConfirmBanner';
import RevertSettlementModal from '../../components/RevertSettlementModal';
import SegmentedTabs from '../../components/SegmentedTabs';
import CarrierSettlementFiles from './CarrierSettlementFiles';
import CarrierEditSettlementModal from './CarrierEditSettlementModal';
import { hasAdminPermission, hasAnyRole } from '../../utils/auth';
import {
  CARRIER_LABEL,
  cancelCarrierSettlement,
  getCarrierSettlement,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import { isSettlementPayable, settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate, toBsDateTime } from '../../utils/nepaliDate';
import '../vendor/VendorFinance.css';
import '../SettlementDetailPage.css';

const money = (value: number) => `Rs. ${value.toLocaleString()}`;

/** A 3PL statement, laid out like the vendor/rider statement page. */
const CarrierSettlementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canCancel = hasAnyRole(['super_admin']) || hasAdminPermission('EDIT_SETTLEMENTS');
  const [detail, setDetail] = useState<CarrierSettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showCancel, setShowCancel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [tab, setTab] = useState<'billing' | 'file'>('billing');
  const [banner, setBanner] = useState<{ title: string; meta?: string } | null>(
    (location.state as { confirmBanner?: { title: string; meta?: string } } | null)?.confirmBanner ?? null,
  );

  useEffect(() => {
    let active = true;
    getCarrierSettlement(id)
      .then((data) => active && setDetail(data))
      .catch((err) => active && setError(err?.response?.data?.message || 'Failed to load this settlement.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, reloadKey]);

  const label = detail ? CARRIER_LABEL[detail.carrier] : '';

  return (
    <div className="settlement-detail-page">
      <div className="settlement-detail-toolbar">
        <Button variant="ghost" onClick={() => navigate('/finance/carrier-cod')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="settlement-detail-actions">
          {detail && isSettlementPayable(detail.status) && (
            <Button variant="primary" onClick={() => navigate(`/finance/carrier-cod/${id}/pay`)}>
              <CreditCard size={16} /> {detail.status === 'partially_paid' ? 'Record Balance' : 'Record Payment'}
            </Button>
          )}
          {canCancel && detail?.status === 'pending' && (
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              <Pencil size={16} /> Edit
            </Button>
          )}
          {canCancel && detail?.status === 'pending' && (
            <Button variant="danger" onClick={() => setShowCancel(true)}>
              <Ban size={16} /> Cancel
            </Button>
          )}
        </div>
      </div>

      {banner && <ConfirmBanner title={banner.title} meta={banner.meta} onDismiss={() => setBanner(null)} />}

      {loading ? (
        <div className="loading-state">Loading statement…</div>
      ) : error ? (
        <p className="vendor-finance-error">{error}</p>
      ) : detail ? (
        <>
          <SegmentedTabs
            ariaLabel="Statement view"
            fullWidth={false}
            minTabWidth="140px"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'billing', label: 'Billing details' },
              { value: 'file', label: 'Settlement file', count: detail.documents.length },
            ]}
          />
          {tab === 'file' ? (
            <CarrierSettlementFiles settlementId={detail.id} documents={detail.documents} onChanged={() => setReloadKey((k) => k + 1)} />
          ) : (
            <div className="sdp-bill">
              <div className="sdp-bill-head">
                <span className="sdp-avatar">{label.slice(0, 2).toUpperCase()}</span>
                <div className="sdp-payee-text">
                  <div className="sdp-payee-name-row">
                    <span className="sdp-payee-name">{label}</span>
                    <StatusChip variant="solid" tone={settlementStatusTone(detail.status)}>
                      {settlementStatusLabel(detail.status)}
                    </StatusChip>
                  </div>
                  <span className="sdp-payee-sub">3PL carrier</span>
                </div>
              </div>
    
              <div className="sdp-meta">
                <div>
                  <span>Statement</span>
                  <span className="sdp-mono">{detail.statementNo}</span>
                </div>
                <div>
                  <span>Statement date</span>
                  <span>{toBsDate(detail.settlementDate) || '-'}</span>
                </div>
                <div>
                  <span>Recorded</span>
                  <span>{toBsDateTime(detail.createdAt) || '-'}</span>
                </div>
                {detail.settledAt && (
                  <div>
                    <span>Settled</span>
                    <span>{toBsDateTime(detail.settledAt)}</span>
                  </div>
                )}
                {detail.paymentBreakdown.length > 0 && (
                  <div>
                    <span>Payment method</span>
                    <span>{detail.paymentBreakdown.map((p) => `${p.method}: ${money(p.amount)}`).join(', ')}</span>
                  </div>
                )}
                {detail.status === 'partially_paid' && (
                  <>
                    <div>
                      <span>Received so far</span>
                      <span>{money(detail.paidAmount)}</span>
                    </div>
                    <div>
                      <span>Still outstanding</span>
                      <span className="sdp-outstanding">{money(detail.remainingAmount)}</span>
                    </div>
                  </>
                )}
                {detail.remark && (
                  <div>
                    <span>Remark</span>
                    <span>{detail.remark}</span>
                  </div>
                )}
              </div>
    
              {detail.payments.length > 0 && (
                <div className="sdp-payments">
                  <h3>Payment history</h3>
                  <div className="sdp-payments-list">
                    {detail.payments.map((payment, index) => (
                      <div className="sdp-payment" key={payment.id}>
                        <div className="sdp-payment-head">
                          <span className="sdp-payment-amount">{money(payment.amount)}</span>
                          <span className="sdp-payment-date">{toBsDateTime(payment.paidAt) || '-'}</span>
                        </div>
                        <div className="sdp-payment-meta">
                          <span>
                            {detail.payments.length > 1 ? `Payment ${index + 1} · ` : ''}
                            {payment.method}
                          </span>
                        </div>
                        {payment.remark && <p className="sdp-payment-remark">{payment.remark}</p>}
                      </div>
                    ))}
                  </div>
                  {detail.remainingAmount > 0 && (
                    <p className="sdp-payments-outstanding">{money(detail.remainingAmount)} still outstanding on this statement.</p>
                  )}
                </div>
              )}
    
              <div className="sdp-table-wrap">
                <table className="sdp-table">
                  <thead>
                    <tr>
                      <th>SN</th>
                      <th>Order ID</th>
                      <th>Transaction ID</th>
                      <th>Vendor</th>
                      <th>Receiver</th>
                      <th>Destination</th>
                      <th className="sdp-num">Collected COD</th>
                      <th className="sdp-num">{label} Charge</th>
                      <th className="sdp-num">Net Receivable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item, index) => (
                      <tr key={item.codCollectionId}>
                        <td>{index + 1}</td>
                        <td>#{item.orderNumber}</td>
                        <td className="sdp-mono">{item.trackingId}</td>
                        <td>{item.vendorName || '-'}</td>
                        <td>{item.receiverName}</td>
                        <td>{item.destination || '-'}</td>
                        <td className="sdp-num">{money(item.collectedAmount)}</td>
                        <td className="sdp-num">{money(item.carrierCharge)}</td>
                        <td className="sdp-cell-strong sdp-num">{money(item.netAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
    
              <div className="sdp-totals">
                <div>
                  <span>Collected COD</span>
                  <span>{money(detail.grossCod)}</span>
                </div>
                <div>
                  <span>{label} Charges</span>
                  <span>{money(detail.carrierCharges)}</span>
                </div>
                <div className="sdp-totals-payable">
                  <span>Receivable Amount</span>
                  <span>{money(detail.netReceivable)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      {showCancel && detail && (
        <RevertSettlementModal
          settlementId={detail.id}
          statementId={detail.statementNo}
          mode="cancel"
          submit={cancelCarrierSettlement}
          onClose={() => setShowCancel(false)}
          onSuccess={() => {
            setReloadKey((k) => k + 1);
            setBanner({ title: `${detail.statementNo} cancelled`, meta: 'Its orders are free for a future statement' });
          }}
        />
      )}

      {showEdit && detail && (
        <CarrierEditSettlementModal
          detail={detail}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setReloadKey((k) => k + 1);
            setBanner({ title: `${detail.statementNo} updated` });
          }}
        />
      )}
    </div>
  );
};

export default CarrierSettlementDetailPage;
