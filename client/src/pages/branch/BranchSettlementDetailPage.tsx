import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CreditCard, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import SegmentedTabs from '../../components/SegmentedTabs';
import StatusChip from '../../components/StatusChip';
import Table from '../../components/Table';
import { Banner } from '../accounting/ui';
import { getCurrentUserRoles } from '../../utils/auth';
import {
  getBranchSettlement,
  payBranchSettlement,
  type BranchSettlementDetail,
} from '../../services/branchTracking.service';
import { getPaymentMethods, type PaymentMethodOption } from '../../services/paymentMethods.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import type { ParcelStatus } from '../../services/orders.service';
import '../../pages/SettlementCreatePage.css';
import './BranchSettlement.css';
import './BranchSettlementDetailPage.css';

type PaymentRow = { method: string; amount: string };
type DetailTab = 'statement' | 'proof';
const money = (value: number) => `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (value: number) => Math.round(value * 100) / 100;
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
const uploadUrl = (path: string) => `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;
const isPdfPath = (path: string) => /\.pdf$/i.test(path);

const BranchSettlementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canRecordOfficePayment = getCurrentUserRoles().includes('super_admin');
  const [detail, setDetail] = useState<BranchSettlementDetail | null>(null);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: '' }]);
  const [remark, setRemark] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('statement');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state && typeof location.state === 'object' && 'created' in location.state ? 'Pending statement created. Record payment when the branch remits the COD.' : '');

  const activeMethods = useMemo(() => methods.filter((method) => method.isActive), [methods]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statement, paymentMethods] = await Promise.all([getBranchSettlement(id), getPaymentMethods()]);
      setDetail(statement);
      setMethods(paymentMethods);
      setPayments((current) => current.length === 1 && !current[0].amount
        ? [{ method: paymentMethods[0]?.name ?? '', amount: String(statement.remainingAmount) }]
        : current);
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load this branch settlement.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const enteredAmount = round2(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  const updatePayment = (index: number, patch: Partial<PaymentRow>) => setPayments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const removePayment = (index: number) => setPayments((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current);

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    const validPayments = payments.map((payment) => ({ method: payment.method.trim(), amount: Number(payment.amount) || 0 })).filter((payment) => payment.amount > 0 || detail.remainingAmount === 0);
    if (validPayments.length === 0) { setError('Enter at least one payment amount.'); return; }
    if (validPayments.some((payment) => !payment.method)) { setError('Choose a payment method for every amount.'); return; }
    if (enteredAmount > detail.remainingAmount) { setError(`Payment is more than the ${money(detail.remainingAmount)} outstanding balance.`); return; }
    setSaving(true);
    setError('');
    try {
      const response = await payBranchSettlement(id, { payments: validPayments, ...(remark.trim() ? { remark: remark.trim() } : {}) });
      setNotice(response.data.status === 'settled' ? 'Branch settlement completed and now counted as deposited.' : `${money(response.data.remainingAmount)} remains outstanding on this statement.`);
      setRemark('');
      setPayments([{ method: activeMethods[0]?.name ?? '', amount: '' }]);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record branch payment.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="scp-page"><div className="scp-empty">Loading branch settlement…</div></div>;
  if (!detail) return <div className="scp-page"><Button variant="secondary" onClick={() => navigate('/branches/settlement')}>Back to settlements</Button><Banner tone="danger">{error || 'Branch settlement not found.'}</Banner></div>;

  const payable = detail.status === 'pending' || detail.status === 'partially_paid';
  const hasVerifiedPayment = detail.status === 'partially_paid' || detail.status === 'settled';
  const paymentColumns = [
    { header: 'Paid at', accessor: (payment: BranchSettlementDetail['payments'][number]) => toBsDate(payment.paidAt) || payment.paidAt.slice(0, 10), width: '130px' },
    { header: 'Method', accessor: (payment: BranchSettlementDetail['payments'][number]) => payment.method, width: '180px' },
    { header: 'Amount', accessor: (payment: BranchSettlementDetail['payments'][number]) => money(payment.amount), width: '140px', className: 'branch-money-cell' },
    { header: 'Breakdown', accessor: (payment: BranchSettlementDetail['payments'][number]) => payment.breakdown.map((line) => `${line.method} · ${money(line.amount)}`).join(' · '), width: '250px' },
    { header: 'Recorded by', accessor: (payment: BranchSettlementDetail['payments'][number]) => payment.recordedBy || '—', width: '160px' },
    { header: 'Remark', accessor: (payment: BranchSettlementDetail['payments'][number]) => payment.remark || '—', width: '200px' },
  ];
  const orderColumns = [
    { header: 'Order', accessor: (item: BranchSettlementDetail['items'][number]) => `#${item.orderNumber}`, width: '85px' },
    { header: 'Tracking ID', accessor: (item: BranchSettlementDetail['items'][number]) => item.trackingId, width: '170px' },
    { header: 'Receiver', accessor: (item: BranchSettlementDetail['items'][number]) => <div className="party-cell"><span>{item.receiverName}</span><small>{item.receiverPhone}</small></div>, width: '185px' },
    { header: 'Route', accessor: (item: BranchSettlementDetail['items'][number]) => `${item.origin || '—'} → ${item.destination || '—'}`, width: '220px' },
    { header: 'Collected', accessor: (item: BranchSettlementDetail['items'][number]) => money(item.collectedAmount), width: '125px', className: 'branch-money-cell' },
    { header: 'Commission credit', accessor: (item: BranchSettlementDetail['items'][number]) => money(item.commissionAmount), width: '145px', className: 'branch-money-cell' },
    { header: 'Net payable', accessor: (item: BranchSettlementDetail['items'][number]) => money(item.netPayable), width: '130px', className: 'branch-money-cell' },
    { header: 'Order status', accessor: (item: BranchSettlementDetail['items'][number]) => <StatusChip tone={getOrderStatusTone(item.status as ParcelStatus)}>{ORDER_STATUS_LABELS[item.status as keyof typeof ORDER_STATUS_LABELS] || item.status}</StatusChip>, width: '150px' },
  ];

  return (
    <div className="scp-page bsd-page">
      <button type="button" className="scp-back" onClick={() => navigate('/branches/settlement')}><ArrowLeft size={15} />Branch Statements</button>
      <div className="bsd-heading"><div><h1>{detail.statementNo}</h1><p><strong>{detail.fromBranch.name}</strong> pays collected COD to master branch <strong>{detail.toBranch.name}</strong>.</p></div><StatusChip variant="solid" tone={settlementStatusTone(detail.status)}>{settlementStatusLabel(detail.status)}</StatusChip></div>
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}

      {hasVerifiedPayment && (
        <SegmentedTabs
          ariaLabel="Branch statement view"
          fullWidth={false}
          minTabWidth="150px"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'statement', label: 'Statement details' },
            { value: 'proof', label: 'Payment proof', count: detail.paymentProofs.length },
          ]}
        />
      )}

      {activeTab === 'proof' && hasVerifiedPayment ? (
        <section className="bsd-proof-panel" aria-label="Verified payment proof">
          {detail.paymentProofs.length === 0 ? (
            <div className="bsd-proof-empty">
              <FileText size={22} />
              <strong>No payment proof attached</strong>
              <p>This payment was recorded directly by the office without an uploaded receipt.</p>
            </div>
          ) : detail.paymentProofs.map((proof, index) => {
            const href = uploadUrl(proof.proofPath);
            return (
              <article className="bsd-proof-card" key={proof.id}>
                <div className="bsd-proof-meta">
                  <div><span>{detail.paymentProofs.length > 1 ? `Payment ${index + 1}` : 'Verified payment'}</span><strong>{money(proof.amount)}</strong></div>
                  <div><span>Method</span><strong>{proof.method}</strong></div>
                  <div><span>Reference</span><strong>{proof.reference || '—'}</strong></div>
                  <div><span>Verified</span><strong>{proof.verifiedAt ? toBsDate(proof.verifiedAt) || proof.verifiedAt.slice(0, 10) : 'Verified'}</strong></div>
                </div>
                {isPdfPath(proof.proofPath) ? (
                  <iframe className="bsd-proof-pdf" src={href} title={`Payment proof ${index + 1}`} />
                ) : (
                  <a className="bsd-proof-image" href={href} target="_blank" rel="noreferrer">
                    <img src={href} alt={`Payment proof ${index + 1}`} loading="lazy" />
                  </a>
                )}
                <a className="bsd-proof-open" href={href} target="_blank" rel="noreferrer"><FileText size={14} /> Open in new tab <ExternalLink size={12} /></a>
                {proof.note && <p className="bsd-proof-note">{proof.note}</p>}
              </article>
            );
          })}
        </section>
      ) : (
        <>
          <section className="bsd-ledger" aria-label="Settlement balance">
            <div><span>Gross COD</span><strong>{money(detail.grossCod)}</strong></div>
            <div><span>Commission credit</span><strong>{money(detail.commissionAmount)}</strong><small>{money(detail.commissionPerParcel)} per parcel retained by {detail.fromBranch.name}</small></div>
            <div><span>Net payable</span><strong>{money(detail.netPayable)}</strong></div>
            <div><span>Paid</span><strong>{money(detail.paidAmount)}</strong></div>
            <div><span>Outstanding</span><strong className={detail.remainingAmount > 0 ? 'branch-balance-due' : 'branch-balance-clear'}>{money(detail.remainingAmount)}</strong><small>{detail.settledAt ? `Completed ${toBsDate(detail.settledAt) || detail.settledAt.slice(0, 10)}` : 'Waiting for payment'}</small></div>
          </section>

          {payable && canRecordOfficePayment && (
        <section className="scp-section bsd-payment-section">
          <div className="scp-section-header"><div className="scp-section-icon"><CreditCard size={18} /></div><div><h3>Record branch payment</h3><p>Partial payments remain open. The statement is settled only when the balance reaches zero.</p></div></div>
          {activeMethods.length === 0 ? <Banner tone="danger">No active payment method is configured. Add one in Settings before recording a payment.</Banner> : (
            <form onSubmit={recordPayment} className="bsd-payment-form" noValidate>
              {payments.map((payment, index) => <div key={index} className="bsd-payment-row"><FormField label={index === 0 ? 'Payment method' : ''} type="select" value={payment.method} onChange={(value) => updatePayment(index, { method: value })} options={activeMethods.map((method) => ({ value: method.name, label: method.name }))} /><FormField label={index === 0 ? 'Amount' : ''} type="decimal" value={payment.amount} onChange={(value) => updatePayment(index, { amount: value })} placeholder="0.00" /><Button type="button" variant="ghost" size="icon" aria-label="Remove payment row" onClick={() => removePayment(index)} disabled={payments.length === 1}><Trash2 size={16} /></Button></div>)}
              <div className="bsd-payment-actions"><Button type="button" variant="secondary" size="sm" onClick={() => setPayments((current) => [...current, { method: activeMethods[0]?.name ?? '', amount: '' }])}><Plus size={14} /> Split payment</Button><span>{enteredAmount > 0 ? `${money(enteredAmount)} to record · ${money(Math.max(0, detail.remainingAmount - enteredAmount))} after payment` : `${money(detail.remainingAmount)} outstanding`}</span></div>
              <FormField label="Payment remark" type="textarea" value={remark} onChange={setRemark} rows={2} placeholder="Optional reference, receipt number, or note" />
              <div className="scp-actions"><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Recording…' : enteredAmount === detail.remainingAmount ? 'Complete settlement' : 'Record part payment'}</Button></div>
            </form>
          )}
        </section>
          )}
          {payable && !canRecordOfficePayment && <Banner tone="info">Submit the paid receipt from Branch Billing & Credit. The office will verify it before this statement is cleared.</Banner>}

          <section className="scp-section"><div className="scp-section-header"><div><h3>Payment history</h3><p>Every transfer remains visible here, including split or partial payments.</p></div></div><Table selectable={false} data={detail.payments} columns={paymentColumns} minWidth="1060px" emptyMessage="No payment has been recorded yet." /></section>
          <section className="scp-section"><div className="scp-section-header"><div><h3>Statement orders ({detail.items.length})</h3><p>These orders are earmarked for this statement and cannot be added to another one.</p></div></div><Table selectable={false} data={detail.items.map((item) => ({ ...item, id: item.parcelId }))} columns={orderColumns} minWidth="1210px" emptyMessage="No orders on this statement." /></section>
        </>
      )}
    </div>
  );
};

export default BranchSettlementDetailPage;
