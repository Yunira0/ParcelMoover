import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, FileText, Paperclip, Upload, Users, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
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
import './SettlementCreatePage.css';
import './SettlementPayPage.css';

type PaymentRow = { method: string; amount: string };

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="scp-section-header">
    <div className="scp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

const PayeeRow: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="spp-payee-row">
    <span className="spp-payee-label">{label}</span>
    <span className="spp-payee-value">{value || '—'}</span>
  </div>
);

const FileField: React.FC<{
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
}> = ({ label, hint, file, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="spp-file-field">
      <span className="spp-file-label">{label}</span>
      {file ? (
        <div className="spp-file-chip">
          <FileText size={14} />
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${label}`}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="spp-file-btn" onClick={() => ref.current?.click()}>
          <Upload size={15} /> Choose file
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <span className="spp-file-hint">{hint}</span>
    </div>
  );
};

const SettlementPayPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isSuperAdmin = hasAnyRole(['super_admin']);

  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: '' }]);
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const [taxInvoice, setTaxInvoice] = useState<File | null>(null);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  const expectedTotal = Math.abs(payableAmount);
  const enteredAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remainingAmount = expectedTotal - enteredAmount;
  const hasBankDetails = Boolean(detail?.bankName || detail?.bankAccountNo || detail?.bankAccountHolder);

  useEffect(() => {
    let active = true;
    getSettlementDetail(id)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        // Prefill the single row with the full amount, as the modal did.
        setPayments((prev) =>
          prev.length === 1 && !prev[0].amount
            ? [{ ...prev[0], amount: String(Math.abs(data.payableAmount)) }]
            : prev,
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
    setError('');

    const validPayments = payments
      .map((p) => ({ method: p.method, amount: parseFloat(p.amount) || 0 }))
      .filter((p) => p.amount > 0);

    if (validPayments.length === 0) {
      setError('Please enter at least one payment amount.');
      return;
    }
    if (validPayments.some((p) => !p.method)) {
      setError('Please choose a payment method for each amount.');
      return;
    }
    if (Math.round(remainingAmount * 100) !== 0) {
      setError(`Payment total must equal Rs. ${expectedTotal.toLocaleString()} (remaining Rs. ${remainingAmount.toLocaleString()}).`);
      return;
    }

    setLoading(true);
    try {
      await paySettlement(id, validPayments, remark.trim(), { paymentReceipt, taxInvoice });
      navigate(`/finance/settlements/${id}`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  if (loadingDetail) {
    return <div className="scp-page"><div className="scp-empty">Loading settlement...</div></div>;
  }

  if (!detail) {
    return (
      <div className="scp-page">
        <div className="scp-empty">{error || 'Settlement not found.'}</div>
      </div>
    );
  }

  if (detail.status === 'settled') {
    return (
      <div className="scp-page">
        <button type="button" className="scp-back" onClick={() => navigate(`/finance/settlements/${id}`)}>
          <ArrowLeft size={15} />
          Settlement
        </button>
        <div className="scp-empty">This statement has already been paid.</div>
      </div>
    );
  }

  return (
    <div className="scp-page">
      <button type="button" className="scp-back" onClick={() => navigate(`/finance/settlements/${id}`)}>
        <ArrowLeft size={15} />
        {detail.statementId}
      </button>

      <PageHeader
        title="Make Payment"
        subtitle={`Record the payout for ${detail.statementId} and attach the paperwork.`}
      />

      <form className="scp-form" onSubmit={handleSubmit} noValidate>
        {vendorOwesOffice && (
          <div className="spp-warning">
            This vendor owes the office Rs. {expectedTotal.toLocaleString()} — the delivery charges
            exceeded the COD collected. Record the amount received <strong>from the vendor</strong> below.
          </div>
        )}

        <section className="scp-section">
          <SectionHeader
            icon={<Users size={18} />}
            title={vendorOwesOffice ? 'Payment from' : 'Pay to'}
            description="Where this payout goes. Taken from the payee's profile."
          />
          <div className="spp-payee">
            <PayeeRow label="Name" value={detail.payeeName} />
            <PayeeRow label="Phone" value={detail.payeePhone} />
            {hasBankDetails ? (
              <>
                <PayeeRow label="Bank" value={detail.bankName} />
                <PayeeRow label="Account no." value={detail.bankAccountNo} />
                <PayeeRow label="Account holder" value={detail.bankAccountHolder} />
              </>
            ) : (
              <div className="spp-payee-empty">No bank account on file.</div>
            )}
          </div>
        </section>

        <section className="scp-section">
          <SectionHeader
            icon={<Banknote size={18} />}
            title="Payment method"
            description={`Split across as many methods as you like — the total must equal Rs. ${expectedTotal.toLocaleString()}.`}
          />

          {payments.map((p, index) => (
            <div key={index} className="spp-payment-row">
              <select
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
              <input
                type="number"
                min="0"
                step="0.01"
                value={p.amount}
                onChange={(event) => updatePayment(index, { amount: event.target.value })}
                placeholder="Amount"
              />
              {payments.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removePayment(index)}>
                  <X size={16} />
                </Button>
              )}
            </div>
          ))}

          <div className="spp-payment-actions">
            <Button type="button" variant="secondary" size="sm" onClick={addPayment}>
              + Add method
            </Button>
            {isSuperAdmin && (
              <button type="button" className="spp-manage-toggle" onClick={() => setShowManage((s) => !s)}>
                {showManage ? 'Hide' : 'Manage payment methods'}
              </button>
            )}
          </div>

          {isSuperAdmin && showManage && (
            <div className="spp-manage">
              <div className="spp-manage-add">
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
                <div key={m.id} className={`spp-manage-row${m.isActive ? '' : ' spp-manage-row--off'}`}>
                  <span>
                    {m.name}
                    {!m.isActive && <span className="spp-manage-disabled"> (disabled)</span>}
                  </span>
                  <button
                    type="button"
                    className={m.isActive ? 'spp-manage-danger' : 'spp-manage-success'}
                    onClick={() => handleToggleMethod(m)}
                  >
                    {m.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}

              {methodError && <p className="error-text">{methodError}</p>}
            </div>
          )}

          <div className="spp-totals">
            <span className="spp-total-entered">Total entered: Rs. {enteredAmount.toLocaleString()}</span>
            <span className={`spp-total-remaining${remainingAmount === 0 ? ' spp-total-remaining--ok' : ''}`}>
              Remaining payable: Rs. {remainingAmount.toLocaleString()}
            </span>
          </div>
        </section>

        <section className="scp-section">
          <SectionHeader
            icon={<Paperclip size={18} />}
            title="Documents"
            description="Optional evidence for this payout — attach whichever you have."
          />
          <div className="spp-files">
            <FileField
              label="Payment receipt"
              hint="Bank slip or wallet screenshot · JPG, PNG, WebP or PDF · max 5 MB"
              file={paymentReceipt}
              onChange={setPaymentReceipt}
            />
            <FileField
              label="Tax invoice"
              hint="Invoice raised against this payout · JPG, PNG, WebP or PDF · max 5 MB"
              file={taxInvoice}
              onChange={setTaxInvoice}
            />
          </div>
        </section>

        <section className="scp-section">
          <FormField
            label="Remark"
            type="textarea"
            rows={2}
            value={remark}
            onChange={setRemark}
            placeholder="e.g. Paid by bank transfer, Nabil ref 884213 — cheque collected by Sita"
            hint="Optional. Note anything that won't be obvious from the receipt later — a reference number, who collected it, or why the amount was split."
          />
        </section>

        {error && (
          <div className="scp-error" role="alert">
            {error}
          </div>
        )}

        <div className="scp-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/finance/settlements/${id}`)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit payment'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SettlementPayPage;
