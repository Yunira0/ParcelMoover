import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, X } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import {
  CARRIER_LABEL,
  getCarrierSettlement,
  payCarrierSettlement,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import { getPaymentMethods, type PaymentMethodOption } from '../../services/paymentMethods.service';
import '../SettlementPayPage.css';

type PaymentRow = { method: string; amount: string };
type AmountMode = 'full' | 'partial';

const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => `Rs. ${value.toLocaleString()}`;

/** Record what a carrier paid - the rider flow of the statement pay page (no proof step). */
const CarrierSettlementPayPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CarrierSettlementDetail | null>(null);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: '' }]);
  const [amountMode, setAmountMode] = useState<AmountMode>('full');
  const [remark, setRemark] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeMethods = useMemo(() => methods.filter((m) => m.isActive), [methods]);

  useEffect(() => {
    let active = true;
    Promise.all([getCarrierSettlement(id), getPaymentMethods()])
      .then(([data, list]) => {
        if (!active) return;
        setDetail(data);
        setMethods(list);
        setPayments([{ method: list.find((m) => m.isActive)?.name ?? '', amount: String(data.remainingAmount) }]);
      })
      .catch(() => active && setError('Failed to load this settlement.'))
      .finally(() => active && setLoadingDetail(false));
    return () => { active = false; };
  }, [id]);

  const outstanding = detail?.remainingAmount ?? 0;
  const enteredAmount = round2(payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0));
  const shortfall = round2(outstanding - enteredAmount);
  const clearsStatement = shortfall === 0;
  const isOver = shortfall < 0;
  const isSubmittable = !isOver && (amountMode === 'full' ? clearsStatement : enteredAmount > 0);

  const updatePayment = (index: number, patch: Partial<PaymentRow>) =>
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const back = () => navigate(`/finance/carrier-cod/${id}`);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setError('');
    const lines = payments.map((p) => ({ method: p.method, amount: parseFloat(p.amount) || 0 })).filter((p) => p.amount > 0);
    if (lines.length === 0) { setError('Please enter at least one payment amount.'); return; }
    if (lines.some((p) => !p.method)) { setError('Please choose a payment method for each amount.'); return; }
    if (isOver) { setError(`Payment total is more than the ${money(outstanding)} outstanding on this statement.`); return; }
    if (amountMode === 'full' && !clearsStatement) {
      setError(`Payment total must equal ${money(outstanding)} (${money(shortfall)} left). Switch to "Part payment" to record less.`);
      return;
    }
    setLoading(true);
    try {
      const { data } = await payCarrierSettlement(id, lines, remark);
      const via = Array.from(new Set(lines.map((p) => p.method))).join(', ');
      navigate(`/finance/carrier-cod/${id}`, {
        state: {
          confirmBanner: {
            title: `${money(enteredAmount)} recorded`,
            meta: data.remainingAmount > 0 ? `via ${via} · ${money(data.remainingAmount)} still outstanding` : `via ${via}`,
          },
        },
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  if (loadingDetail) return <div className="mpp-page"><div className="mpp-empty">Loading settlement…</div></div>;
  if (!detail) return <div className="mpp-page"><div className="mpp-empty">{error || 'Settlement not found.'}</div></div>;
  if (detail.status === 'settled' || detail.status === 'cancelled') {
    return (
      <div className="mpp-page">
        <button type="button" className="mpp-back" onClick={back}><ArrowLeft size={15} />Settlement</button>
        <div className="mpp-empty">
          {detail.status === 'settled' ? 'This statement has already been paid.' : 'This statement has been cancelled.'}
        </div>
      </div>
    );
  }

  const label = CARRIER_LABEL[detail.carrier];

  return (
    <div className="mpp-page">
      <button type="button" className="mpp-back" onClick={back}>
        <ArrowLeft size={15} />
        {detail.statementNo}
      </button>

      <div className="mpp-top">
        <h1>Record Payment</h1>
      </div>

      <div className="mpp-step-content">
        <form className="mpp-ledger" onSubmit={handleSubmit} noValidate>
          <div className="mpp-bill">
            <div className="mpp-payee">
              <span className="mpp-avatar">{label.slice(0, 2).toUpperCase()}</span>
              <div className="mpp-payee-text">
                <span className="mpp-payee-name">{label}</span>
                <span className="mpp-payee-phone">3PL carrier</span>
              </div>
            </div>
            <div className="mpp-due">
              <span className="mpp-due-label">{detail.paidAmount > 0 ? 'Still outstanding' : 'Receivable amount'}</span>
              <span className="mpp-due-value">{money(outstanding)}</span>
              {detail.paidAmount > 0 && (
                <span className="mpp-due-note">{money(detail.paidAmount)} of {money(detail.netReceivable)} already received</span>
              )}
            </div>
          </div>

          <div className="mpp-zone">
            <h3>How much is being received</h3>
            <div className="mpp-mode" role="group" aria-label="Payment amount">
              <button
                type="button"
                className={`mpp-mode-option${amountMode === 'full' ? ' mpp-mode-option--active' : ''}`}
                aria-pressed={amountMode === 'full'}
                onClick={() => {
                  setAmountMode('full');
                  setError('');
                  setPayments((prev) => (prev.length === 1 ? [{ ...prev[0], amount: String(outstanding) }] : prev));
                }}
              >
                <span className="mpp-mode-title">Received in full</span>
                <span className="mpp-mode-sub">{money(outstanding)}</span>
              </button>
              <button
                type="button"
                className={`mpp-mode-option${amountMode === 'partial' ? ' mpp-mode-option--active' : ''}`}
                aria-pressed={amountMode === 'partial'}
                onClick={() => { setAmountMode('partial'); setError(''); }}
              >
                <span className="mpp-mode-title">Part payment</span>
                <span className="mpp-mode-sub">Record less, the rest later</span>
              </button>
            </div>

            <h3>Payment method</h3>
            {payments.map((p, index) => (
              <div key={index} className="mpp-payment-row">
                <select className="mpp-method-select" value={p.method} onChange={(e) => updatePayment(index, { method: e.target.value })}>
                  {activeMethods.length === 0 && <option value="">No methods available</option>}
                  {activeMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
                <div className="mpp-amount-field">
                  <span className="mpp-amount-prefix">Rs.</span>
                  <input type="number" min="0" step="0.01" value={p.amount} onChange={(e) => updatePayment(index, { amount: e.target.value })} placeholder="0" />
                </div>
                {payments.length > 1 && (
                  <button
                    type="button"
                    className="mpp-row-remove"
                    onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remove method"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
            <div className="mpp-payment-actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPayments((prev) => [...prev, { method: activeMethods[0]?.name ?? '', amount: '' }])}>
                + Add method
              </Button>
            </div>

            <div className={`mpp-balance${isSubmittable ? ' mpp-balance--ok' : ''}${isOver ? ' mpp-balance--over' : ''}`}>
              <span>{money(enteredAmount)} entered</span>
              <span className="mpp-balance-status">
                {isOver ? (
                  `${money(Math.abs(shortfall))} over`
                ) : clearsStatement ? (
                  <><CheckCircle2 size={13} /> Settles this statement</>
                ) : amountMode === 'partial' && enteredAmount > 0 ? (
                  <><CheckCircle2 size={13} /> {money(shortfall)} will remain outstanding</>
                ) : (
                  `${money(shortfall)} left of ${money(outstanding)}`
                )}
              </span>
            </div>
          </div>

          <div className="mpp-zone">
            <FormField
              label="Remark"
              type="textarea"
              rows={2}
              value={remark}
              onChange={setRemark}
              placeholder={`e.g. ${label} transfer reference`}
              hint="Optional. Note anything that won't be obvious later — a reference number or why the amount was split."
            />
          </div>

          {error && <div className="mpp-error" role="alert">{error}</div>}

          <div className="mpp-actions">
            <Button type="button" variant="secondary" onClick={back} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Recording...' : amountMode === 'partial' && !clearsStatement ? 'Record part payment' : 'Record payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CarrierSettlementPayPage;
