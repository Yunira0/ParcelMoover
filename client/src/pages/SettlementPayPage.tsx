import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import AttachSettlementDocumentsCard from '../components/AttachSettlementDocumentsCard';
import {
  getSettlementDetail,
  paySettlement,
  type SettlementDetail,
} from '../services/finance.service';
import {
  getPaymentMethods,
  createPaymentMethod,
  setPaymentMethodActive,
  type PaymentMethodOption,
} from '../services/paymentMethods.service';
import { hasAnyRole } from '../utils/auth';
import './SettlementPayPage.css';

type PaymentRow = { method: string; amount: string };
type Step = 'pay' | 'proof';
// Whether this visit clears the statement or only chips away at it. A vendor
// may hand over Rs. 1,000 today and the remaining Rs. 2,000 next week, so the
// form has to stop insisting the amounts add up to the whole payable.
type AmountMode = 'full' | 'partial';

// Amounts are Decimal(12,2) server-side but floats here, so every running total
// is snapped back to paisa before it's compared - otherwise a statement paid to
// the last rupee can still read as "Rs. 0.0000001 left".
const round2 = (value: number): number => Math.round(value * 100) / 100;

const money = (value: number): string => `Rs. ${value.toLocaleString()}`;

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const BankRow: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="mpp-bank-row">
    <span>{label}</span>
    <span>{value || '—'}</span>
  </div>
);

// The whole point of this rail is that "record payment" and "attach proof" are
// one continuous act, just split because proof can only exist after the money
// has actually moved — without it the two screens would read as unrelated.
const StepRail: React.FC<{ current: 1 | 2 }> = ({ current }) => (
  <div className="mpp-rail">
    <div className={`mpp-step${current === 1 ? ' mpp-step--active' : ' mpp-step--done'}`}>
      <span className="mpp-step-dot">{current > 1 ? <Check size={11} /> : '1'}</span>
      Payment
    </div>
    <div className={`mpp-step-line${current > 1 ? ' mpp-step-line--done' : ''}`} />
    <div className={`mpp-step${current === 2 ? ' mpp-step--active' : ''}`}>
      <span className="mpp-step-dot">2</span>
      Proof
    </div>
  </div>
);

const SettlementPayPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isSuperAdmin = hasAnyRole(['super_admin']);

  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: '' }]);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2 only exists once payment is actually on record - proof is
  // evidence something already happened, so it can't be requested earlier.
  const [step, setStep] = useState<Step>('pay');
  const [paidSummary, setPaidSummary] = useState<{
    amount: number;
    methodSummary: string;
    /** The instalment just created, so its proof is filed against it and not the statement at large. */
    paymentId?: string;
    remaining: number;
  } | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>('full');

  // Super-admin inline management of the method list.
  const [showManage, setShowManage] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [savingMethod, setSavingMethod] = useState(false);
  const [methodError, setMethodError] = useState('');

  const activeMethods = useMemo(() => methods.filter((m) => m.isActive), [methods]);

  // A negative payable means the COD collected was less than the delivery
  // charges, so the vendor owes the office. The amounts entered then represent
  // cash received FROM the vendor, and must total the absolute amount owed.
  const payableAmount = detail?.payableAmount ?? 0;
  const vendorOwesOffice = payableAmount < 0;
  // Riders remit COD cash they already collected - the office is always
  // receiving from them, never paying out, so the terminology flips.
  const isRider = detail?.payeeType === 'rider';
  const expectedTotal = Math.abs(payableAmount);
  // What this visit can cover: the whole payable on a fresh statement, or
  // whatever is left of it if earlier instalments already went in.
  const alreadyPaid = detail?.paidAmount ?? 0;
  const outstanding = round2(expectedTotal - alreadyPaid);
  const isFollowUpPayment = alreadyPaid > 0;
  const enteredAmount = round2(payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0));
  const shortfall = round2(outstanding - enteredAmount);
  // "Balanced" means this payment closes the statement. In partial mode any
  // amount up to the outstanding balance is fine, so the bar only complains
  // about overpaying or entering nothing.
  const clearsStatement = shortfall === 0;
  const isOver = shortfall < 0;
  const isSubmittable =
    !isOver && (amountMode === 'full' ? clearsStatement : enteredAmount > 0 || outstanding === 0);
  const hasBankDetails = Boolean(detail?.bankName || detail?.bankAccountNo || detail?.bankAccountHolder);

  useEffect(() => {
    let active = true;
    getSettlementDetail(id)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        // Prefill the single row with what's still owed, as the modal did with
        // the full amount - on a statement already part paid, the balance is
        // the figure staff are about to hand over.
        const stillOwed = round2(Math.abs(data.payableAmount) - data.paidAmount);
        setPayments((prev) =>
          prev.length === 1 && !prev[0].amount ? [{ ...prev[0], amount: String(stillOwed) }] : prev,
        );
      })
      .catch(() => {
        if (active) setError('Failed to load this settlement.');
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const loadMethods = useCallback(async () => {
    // Super admins fetch the full list (so they can re-enable disabled ones);
    // everyone else only needs the active set for the dropdown.
    const list = await getPaymentMethods(isSuperAdmin);
    setMethods(list);
    return list;
  }, [isSuperAdmin]);

  useEffect(() => {
    let active = true;
    loadMethods()
      .then((list) => {
        if (!active) return;
        const firstActive = list.find((m) => m.isActive)?.name ?? '';
        setPayments((prev) => prev.map((p) => (p.method ? p : { ...p, method: firstActive })));
      })
      .catch(() => {
        if (active) setError('Failed to load payment methods.');
      });
    return () => {
      active = false;
    };
  }, [loadMethods]);

  const updatePayment = (index: number, patch: Partial<PaymentRow>) => {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addPayment = () => {
    setPayments((prev) => [...prev, { method: activeMethods[0]?.name ?? '', amount: '' }]);
  };

  const removePayment = (index: number) => {
    setPayments((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleAddMethod = async () => {
    const name = newMethodName.trim();
    if (!name) return;
    setSavingMethod(true);
    setMethodError('');
    try {
      const created = await createPaymentMethod(name);
      setNewMethodName('');
      const list = await loadMethods();
      // Auto-select the freshly added method on the first empty/only row.
      setPayments((prev) => {
        const target = list.find((m) => m.id === created.id)?.name ?? created.name;
        if (prev.length === 1 && !parseFloat(prev[0].amount)) {
          return [{ method: target, amount: prev[0].amount }];
        }
        return prev;
      });
    } catch (err: any) {
      setMethodError(err?.response?.data?.message || 'Failed to add method');
    } finally {
      setSavingMethod(false);
    }
  };

  const handleToggleMethod = async (m: PaymentMethodOption) => {
    setMethodError('');
    try {
      await setPaymentMethodActive(m.id, !m.isActive);
      await loadMethods();
    } catch (err: any) {
      setMethodError(err?.response?.data?.message || 'Failed to update method');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setError('');

    // A settlement can legitimately be Rs. 0 (e.g. a single order corrected to
    // 0 collected COD) - keep the row(s) in that case so there's still an
    // honest record of how it was closed, rather than filtering everything
    // out and erroring "at least one payment amount".
    const validPayments = payments
      .map((p) => ({ method: p.method, amount: parseFloat(p.amount) || 0 }))
      .filter((p) => expectedTotal === 0 || p.amount > 0);

    if (validPayments.length === 0) {
      setError('Please enter at least one payment amount.');
      return;
    }
    if (validPayments.some((p) => !p.method)) {
      setError('Please choose a payment method for each amount.');
      return;
    }
    if (isOver) {
      setError(
        `Payment total is more than the ${money(outstanding)} outstanding on this statement.`,
      );
      return;
    }
    if (amountMode === 'full' && !clearsStatement) {
      setError(
        `Payment total must equal ${money(outstanding)} (${money(shortfall)} left). Switch to "Part payment" to record less.`,
      );
      return;
    }

    setLoading(true);
    try {
      const { data } = await paySettlement(id, validPayments, remark.trim());
      const methodSummary = Array.from(new Set(validPayments.map((p) => p.method))).join(', ');
      // Riders are paid cash-in-hand with no paperwork to attach - only
      // vendor payouts go through the receipt/invoice proof step.
      if (detail.payeeType === 'vendor') {
        setPaidSummary({
          amount: enteredAmount,
          methodSummary,
          ...(data.paymentId ? { paymentId: data.paymentId } : {}),
          remaining: data.remainingAmount,
        });
        setStep('proof');
      } else {
        navigate(`/finance/settlements/${id}`, {
          state: {
            confirmBanner: {
              title: `${money(enteredAmount)} recorded`,
              meta:
                data.remainingAmount > 0
                  ? `via ${methodSummary} · ${money(data.remainingAmount)} still outstanding`
                  : `via ${methodSummary}`,
            },
          },
        });
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const goToStatement = () => navigate(`/finance/settlements/${id}`);

  if (loadingDetail) {
    return (
      <div className="mpp-page">
        <div className="mpp-ledger mpp-skeleton" role="status" aria-label="Loading settlement">
          <div className="mpp-bill">
            <div className="mpp-payee">
              <span className="mpp-skeleton-bar mpp-skeleton-avatar" />
              <div className="mpp-payee-text">
                <span className="mpp-skeleton-bar" style={{ width: '140px', height: '16px' }} />
                <span className="mpp-skeleton-bar" style={{ width: '100px', height: '13px', marginTop: 'var(--space-2)' }} />
              </div>
            </div>
            <span className="mpp-skeleton-bar" style={{ width: '110px', height: '28px' }} />
          </div>
          <div className="mpp-zone">
            <span className="mpp-skeleton-bar" style={{ width: '100%', height: '36px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mpp-page">
        <div className="mpp-empty">{error || 'Settlement not found.'}</div>
      </div>
    );
  }

  if (detail.status === 'settled' || detail.status === 'cancelled') {
    return (
      <div className="mpp-page">
        <button type="button" className="mpp-back" onClick={() => navigate(`/finance/settlements/${id}`)}>
          <ArrowLeft size={15} />
          Settlement
        </button>
        <div className="mpp-empty">
          {detail.status === 'settled'
            ? 'This statement has already been paid.'
            : 'This statement has been cancelled.'}
        </div>
      </div>
    );
  }

  if (step === 'proof') {
    return (
      <div className="mpp-page">
        <div className="mpp-top">
          <h1>{detail.statementId}</h1>
          <StepRail current={2} />
        </div>

        <div className="mpp-step-content">
          <div className="mpp-confirm">
            <span className="mpp-confirm-badge">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <div className="mpp-confirm-amount">{money(paidSummary?.amount ?? 0)} recorded</div>
              <div className="mpp-confirm-meta">
                via {paidSummary?.methodSummary} · attach proof now, or add it later from the statement
              </div>
              {/* The statement isn't closed yet, so say so here rather than
                  letting the green tick imply the payout is done. */}
              {(paidSummary?.remaining ?? 0) > 0 && (
                <div className="mpp-confirm-outstanding">
                  {money(paidSummary?.remaining ?? 0)} still outstanding — record it from the statement
                  when it's paid.
                </div>
              )}
            </div>
          </div>

          <AttachSettlementDocumentsCard
            settlementId={id}
            // Filed against the instalment just recorded, so a statement paid in
            // parts keeps each receipt with the payment it actually proves.
            {...(paidSummary?.paymentId ? { paymentId: paidSummary.paymentId } : {})}
            caption="Add the receipt or tax invoice as evidence this transfer went through. You can attach more than one file, and add others later from the statement."
            submitLabel="Attach & finish"
            dismissLabel="Skip for now"
            onDone={goToStatement}
            onDismiss={goToStatement}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mpp-page">
      <button type="button" className="mpp-back" onClick={() => navigate(`/finance/settlements/${id}`)}>
        <ArrowLeft size={15} />
        {detail.statementId}
      </button>

      <div className="mpp-top">
        <h1>{isRider ? 'Record Payment' : 'Make Payment'}</h1>
        {/* Riders have no proof step to lead into - a single-step flow
            doesn't need a rail implying a step 2 that will never show. */}
        {!isRider && <StepRail current={1} />}
      </div>

      <div className="mpp-step-content">
        {vendorOwesOffice && (
          <div className="mpp-warning">
            This vendor owes the office Rs. {expectedTotal.toLocaleString()} — the delivery charges
            exceeded the COD collected. Record the amount received <strong>from the vendor</strong> below.
          </div>
        )}

        <form className="mpp-ledger" onSubmit={handleSubmit} noValidate>
        <div className="mpp-bill">
          <div className="mpp-payee">
            <span className="mpp-avatar">{initials(detail.payeeName || '?')}</span>
            <div className="mpp-payee-text">
              <span className="mpp-payee-name">{detail.payeeName || '—'}</span>
              <span className="mpp-payee-phone">{detail.payeePhone || '—'}</span>
            </div>
          </div>
          <div className="mpp-due">
            <span className="mpp-due-label">
              {isFollowUpPayment
                ? 'Still outstanding'
                : vendorOwesOffice
                  ? 'Owed by vendor'
                  : isRider
                    ? 'Receivable amount'
                    : 'Payable amount'}
            </span>
            <span className="mpp-due-value">{money(outstanding)}</span>
            {/* Where the balance came from — without this, a statement of
                Rs. 3,000 showing Rs. 2,000 due reads as a mistake. */}
            {isFollowUpPayment && (
              <span className="mpp-due-note">
                {money(alreadyPaid)} of {money(expectedTotal)} already paid
              </span>
            )}
          </div>
        </div>

        {hasBankDetails && (
          <div className="mpp-bank">
            <BankRow label="Bank" value={detail.bankName} />
            <BankRow label="Account no." value={detail.bankAccountNo} />
            <BankRow label="Account holder" value={detail.bankAccountHolder} />
          </div>
        )}

        <div className="mpp-zone">
          <h3>How much is being paid</h3>

          {/* A payout doesn't have to clear in one go — Rs. 1,000 now and the
              rest later is a normal way to settle. Full stays the default so
              the common case is still one click. */}
          <div className="mpp-mode" role="group" aria-label="Payment amount">
            <button
              type="button"
              className={`mpp-mode-option${amountMode === 'full' ? ' mpp-mode-option--active' : ''}`}
              aria-pressed={amountMode === 'full'}
              onClick={() => {
                setAmountMode('full');
                setError('');
                // Snap back to the full balance so switching modes can't leave
                // a stale part amount that then fails validation.
                setPayments((prev) =>
                  prev.length === 1
                    ? [{ ...prev[0], amount: String(outstanding) }]
                    : prev,
                );
              }}
            >
              <span className="mpp-mode-title">Pay in full</span>
              <span className="mpp-mode-sub">{money(outstanding)}</span>
            </button>
            <button
              type="button"
              className={`mpp-mode-option${amountMode === 'partial' ? ' mpp-mode-option--active' : ''}`}
              aria-pressed={amountMode === 'partial'}
              onClick={() => {
                setAmountMode('partial');
                setError('');
              }}
            >
              <span className="mpp-mode-title">Part payment</span>
              <span className="mpp-mode-sub">Record less, pay the rest later</span>
            </button>
          </div>

          <h3>Payment method</h3>

          {payments.map((p, index) => (
            <div key={index} className="mpp-payment-row">
              <select
                className="mpp-method-select"
                value={p.method}
                onChange={(event) => updatePayment(index, { method: event.target.value })}
              >
                {/* Keep an option for a value no longer in the active list. */}
                {p.method && !activeMethods.some((m) => m.name === p.method) && (
                  <option value={p.method}>{p.method}</option>
                )}
                {activeMethods.length === 0 && <option value="">No methods available</option>}
                {activeMethods.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="mpp-amount-field">
                <span className="mpp-amount-prefix">Rs.</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={p.amount}
                  onChange={(event) => updatePayment(index, { amount: event.target.value })}
                  placeholder="0"
                />
              </div>
              {payments.length > 1 && (
                <button type="button" className="mpp-row-remove" onClick={() => removePayment(index)} aria-label="Remove method">
                  <X size={15} />
                </button>
              )}
            </div>
          ))}

          <div className="mpp-payment-actions">
            <Button type="button" variant="secondary" size="sm" onClick={addPayment}>
              + Add method
            </Button>
            {isSuperAdmin && (
              <button type="button" className="mpp-manage-toggle" onClick={() => setShowManage((s) => !s)}>
                {showManage ? 'Hide' : 'Manage payment methods'}
              </button>
            )}
          </div>

          {isSuperAdmin && showManage && (
            <div className="mpp-manage">
              <div className="mpp-manage-add">
                <input
                  type="text"
                  value={newMethodName}
                  onChange={(event) => setNewMethodName(event.target.value)}
                  placeholder="New method (e.g. eSewa, Bank)"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddMethod();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleAddMethod}
                  disabled={savingMethod || !newMethodName.trim()}
                >
                  {savingMethod ? 'Adding...' : 'Add'}
                </Button>
              </div>

              {methods.map((m) => (
                <div key={m.id} className={`mpp-manage-row${m.isActive ? '' : ' mpp-manage-row--off'}`}>
                  <span>
                    {m.name}
                    {!m.isActive && <span className="mpp-manage-disabled"> (disabled)</span>}
                  </span>
                  <button
                    type="button"
                    className={m.isActive ? 'mpp-manage-danger' : 'mpp-manage-success'}
                    onClick={() => handleToggleMethod(m)}
                  >
                    {m.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}

              {methodError && <p className="error-text">{methodError}</p>}
            </div>
          )}

          <div
            className={`mpp-balance${isSubmittable ? ' mpp-balance--ok' : ''}${isOver ? ' mpp-balance--over' : ''}`}
          >
            <span>{money(enteredAmount)} entered</span>
            <span className="mpp-balance-status">
              {isOver ? (
                `${money(Math.abs(shortfall))} over`
              ) : clearsStatement ? (
                <>
                  <CheckCircle2 size={13} /> Settles this statement
                </>
              ) : amountMode === 'partial' && enteredAmount > 0 ? (
                <>
                  <CheckCircle2 size={13} /> {money(shortfall)} will remain outstanding
                </>
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
            placeholder="e.g. Paid by bank transfer, Nabil ref 884213 — cheque collected by Sita"
            hint="Optional. Note anything that won't be obvious from the receipt later — a reference number, who collected it, or why the amount was split."
          />
        </div>

        {error && (
          <div className="mpp-error" role="alert">
            {error}
          </div>
        )}

        <div className="mpp-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/finance/settlements/${id}`)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading
              ? 'Recording...'
              : amountMode === 'partial' && !clearsStatement
                ? 'Record part payment'
                : 'Record payment'}
          </Button>
        </div>
      </form>
      </div>
    </div>
  );
};

export default SettlementPayPage;
