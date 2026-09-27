import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CreditCard, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import StatusChip from '../../components/StatusChip';
import Table from '../../components/Table';
import RevertSettlementModal from '../../components/RevertSettlementModal';
import { Banner } from '../accounting/ui';
import { getCurrentUserRoles, hasAdminPermission } from '../../utils/auth';
import {
  CARRIER_LABEL,
  cancelCarrierSettlement,
  getCarrierSettlement,
  payCarrierSettlement,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import { getPaymentMethods, type PaymentMethodOption } from '../../services/paymentMethods.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../SettlementCreatePage.css';
import '../branch/BranchSettlement.css';
import '../branch/BranchSettlementDetailPage.css';

type PaymentRow = { method: string; amount: string };
type Detail = CarrierSettlementDetail;
const money = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

const CarrierSettlementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canCancel = getCurrentUserRoles().includes('super_admin') || hasAdminPermission('EDIT_SETTLEMENTS');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: '' }]);
  const [remark, setRemark] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeMethods = useMemo(() => methods.filter((m) => m.isActive), [methods]);
  const load = useCallback(async () => {
    try {
      const [statement, paymentMethods] = await Promise.all([getCarrierSettlement(id), getPaymentMethods()]);
      setDetail(statement);
      setMethods(paymentMethods);
      setPayments([{ method: paymentMethods.find((m) => m.isActive)?.name ?? '', amount: String(statement.remainingAmount) }]);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load this statement.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!detail) {
    return (
      <div className="scp-page">
        <button type="button" className="scp-back" onClick={() => navigate('/finance/carrier-cod')}><ArrowLeft size={15} />3PL COD</button>
        {error ? <Banner tone="danger">{error}</Banner> : <div className="scp-empty">Loading statement…</div>}
      </div>
    );
  }

  const label = CARRIER_LABEL[detail.carrier];
  const payable = detail.status === 'pending' || detail.status === 'partially_paid';
  const entered = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const updatePayment = (index: number, patch: Partial<PaymentRow>) =>
    setPayments((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const lines = payments.map((p) => ({ method: p.method.trim(), amount: Number(p.amount) || 0 })).filter((p) => p.amount > 0);
    if (lines.length === 0) { setError('Enter the amount received.'); return; }
    if (lines.some((p) => !p.method)) { setError('Choose a payment method for every amount.'); return; }
    if (entered > detail.remainingAmount) { setError(`That is more than the ${money(detail.remainingAmount)} still to receive.`); return; }
    setSaving(true);
    setError('');
    try {
      const res = await payCarrierSettlement(detail.id, lines, remark, proof);
      setNotice(res.data.status === 'settled' ? `${label} statement settled.` : `${money(res.data.remainingAmount)} still to receive on this statement.`);
      setRemark('');
      setProof(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to record the payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scp-page bsd-page">
      <button type="button" className="scp-back" onClick={() => navigate('/finance/carrier-cod')}><ArrowLeft size={15} />3PL COD</button>
      <div className="bsd-heading">
        <div>
          <h1>{detail.statementNo}</h1>
          <p><strong>{label}</strong> pays the COD it collected, less its delivery charge.{detail.remark ? ` ${detail.remark}` : ''}</p>
        </div>
        <div className="bsd-heading-actions">
          {canCancel && detail.status === 'pending' && detail.paidAmount === 0 && (
            <Button variant="danger" size="sm" onClick={() => setShowCancel(true)}><Ban size={15} /> Cancel statement</Button>
          )}
          <StatusChip variant="solid" tone={settlementStatusTone(detail.status)}>{settlementStatusLabel(detail.status)}</StatusChip>
        </div>
      </div>
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}

      <section className="bsd-ledger" aria-label="Statement balance">
        <div><span>COD</span><strong>{money(detail.grossCod)}</strong></div>
        <div><span>{label} charges</span><strong>{money(detail.carrierCharges)}</strong></div>
        <div><span>Net to receive</span><strong>{money(detail.netReceivable)}</strong></div>
        <div><span>Received</span><strong>{money(detail.paidAmount)}</strong></div>
        <div>
          <span>Still to receive</span>
          <strong className={detail.remainingAmount > 0 ? 'branch-balance-due' : 'branch-balance-clear'}>{money(detail.remainingAmount)}</strong>
          <small>{detail.settledAt ? `Settled ${toBsDate(detail.settledAt)}` : 'Waiting for payment'}</small>
        </div>
      </section>

      {payable && (
        <section className="scp-section bsd-payment-section">
          <div className="scp-section-header">
            <div className="scp-section-icon"><CreditCard size={18} /></div>
            <div><h3>Record {label} payment</h3><p>A part payment keeps the statement open until the balance reaches zero.</p></div>
          </div>
          {activeMethods.length === 0 ? (
            <Banner tone="danger">No active payment method is configured. Add one in Settings first.</Banner>
          ) : (
            <form onSubmit={recordPayment} className="bsd-payment-form" noValidate>
              {payments.map((payment, index) => (
                <div key={index} className="bsd-payment-row">
                  <FormField label={index === 0 ? 'Received into' : ''} type="select" value={payment.method} onChange={(v) => updatePayment(index, { method: v })} options={activeMethods.map((m) => ({ value: m.name, label: m.name }))} />
                  <FormField label={index === 0 ? 'Amount' : ''} type="decimal" value={payment.amount} onChange={(v) => updatePayment(index, { amount: v })} placeholder="0.00" />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove payment row" onClick={() => setPayments((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))} disabled={payments.length === 1}><Trash2 size={16} /></Button>
                </div>
              ))}
              <div className="bsd-payment-actions">
                <Button type="button" variant="secondary" size="sm" onClick={() => setPayments((rows) => [...rows, { method: activeMethods[0]?.name ?? '', amount: '' }])}><Plus size={14} /> Split payment</Button>
                <span>{entered > 0 ? `${money(entered)} now · ${money(Math.max(0, round2(detail.remainingAmount - entered)))} left after` : `${money(detail.remainingAmount)} to receive`}</span>
              </div>
              <FormField label="Remark" type="textarea" value={remark} onChange={setRemark} rows={2} placeholder="Optional, e.g. the carrier's transfer reference" />
              <label className="form-group">
                <span>Payment proof (optional)</span>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
              </label>
              <div className="scp-actions">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Recording…' : entered === detail.remainingAmount ? 'Settle statement' : 'Record part payment'}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="scp-section">
        <div className="scp-section-header"><div><h3>Payments received</h3><p>Every instalment from {label}, including part payments.</p></div></div>
        <Table
          selectable={false}
          data={detail.payments}
          emptyMessage="Nothing received yet."
          minWidth="900px"
          columns={[
            { header: 'Received', width: '120px', accessor: (p: Detail['payments'][number]) => toBsDate(p.paidAt) || '—' },
            { header: 'Amount', width: '130px', className: 'branch-money-cell', accessor: (p: Detail['payments'][number]) => money(p.amount) },
            { header: 'Into', width: '220px', accessor: (p: Detail['payments'][number]) => p.breakdown.map((l) => `${l.method} · ${money(l.amount)}`).join(' · ') },
            { header: 'Recorded by', width: '160px', accessor: (p: Detail['payments'][number]) => p.recordedBy || '—' },
            { header: 'Remark', width: '200px', accessor: (p: Detail['payments'][number]) => p.remark || '—' },
          ]}
        />
      </section>

      <section className="scp-section">
        <div className="scp-section-header"><div><h3>Orders ({detail.items.length})</h3><p>Delivered by {label}; each carries the charge {label} kept.</p></div></div>
        <Table
          selectable={false}
          data={detail.items.map((i) => ({ ...i, id: i.codCollectionId }))}
          minWidth="1000px"
          columns={[
            { header: 'Order', width: '80px', accessor: (i: Detail['items'][number]) => `#${i.orderNumber}` },
            { header: 'Tracking ID', width: '170px', accessor: (i: Detail['items'][number]) => i.trackingId },
            { header: 'Vendor', width: '150px', accessor: (i: Detail['items'][number]) => i.vendorName || '—' },
            { header: 'Receiver', width: '150px', accessor: (i: Detail['items'][number]) => i.receiverName },
            { header: 'Destination', width: '130px', accessor: (i: Detail['items'][number]) => i.destination || '—' },
            { header: 'COD', width: '110px', className: 'branch-money-cell', accessor: (i: Detail['items'][number]) => money(i.collectedAmount) },
            { header: `${label} charge`, width: '120px', className: 'branch-money-cell', accessor: (i: Detail['items'][number]) => money(i.carrierCharge) },
            { header: 'Net', width: '110px', className: 'branch-money-cell', accessor: (i: Detail['items'][number]) => money(i.netAmount) },
          ]}
        />
      </section>

      {showCancel && (
        <RevertSettlementModal
          settlementId={detail.id}
          statementId={detail.statementNo}
          mode="cancel"
          submit={cancelCarrierSettlement}
          onClose={() => setShowCancel(false)}
          onSuccess={() => {
            setNotice(`${detail.statementNo} cancelled. Its orders can go on a new statement.`);
            load();
          }}
        />
      )}
    </div>
  );
};

export default CarrierSettlementDetailPage;
