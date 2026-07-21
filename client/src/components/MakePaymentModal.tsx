import React, { useEffect, useMemo, useState } from 'react';
import './Modal.css';
import Button from './Button';
import { paySettlement } from '../services/finance.service';
import {
  getPaymentMethods,
  createPaymentMethod,
  setPaymentMethodActive,
  type PaymentMethodOption,
} from '../services/paymentMethods.service';
import { hasAnyRole } from '../utils/auth';

interface MakePaymentModalProps {
  settlementId: string;
  payableAmount: number;
  onClose: () => void;
  onSuccess: () => void;
}

type PaymentRow = { method: string; amount: string };

const MakePaymentModal: React.FC<MakePaymentModalProps> = ({
  settlementId,
  payableAmount,
  onClose,
  onSuccess,
}) => {
  // A negative payable means the COD collected was less than the delivery
  // charges, so the vendor owes the office. In that case the amounts entered
  // here represent cash received FROM the vendor, and must total the absolute
  // amount owed.
  const vendorOwesOffice = payableAmount < 0;
  const expectedTotal = Math.abs(payableAmount);
  const isSuperAdmin = hasAnyRole(['super_admin']);

  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: '', amount: String(expectedTotal) }]);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Super-admin inline management of the method list.
  const [showManage, setShowManage] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [savingMethod, setSavingMethod] = useState(false);
  const [methodError, setMethodError] = useState('');

  const activeMethods = useMemo(() => methods.filter((m) => m.isActive), [methods]);

  const loadMethods = async () => {
    // Super admins fetch the full list (so they can re-enable disabled ones);
    // everyone else only needs the active set for the dropdown.
    const list = await getPaymentMethods(isSuperAdmin);
    setMethods(list);
    return list;
  };

  useEffect(() => {
    let active = true;
    getPaymentMethods(isSuperAdmin)
      .then((list) => {
        if (!active) return;
        setMethods(list);
        // Default any not-yet-chosen method to the first active one.
        const firstActive = list.find((m) => m.isActive)?.name ?? '';
        setPayments((prev) => prev.map((p) => (p.method ? p : { ...p, method: firstActive })));
      })
      .catch(() => {
        if (active) setError('Failed to load payment methods.');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enteredAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remainingAmount = expectedTotal - enteredAmount;

  const updatePayment = (index: number, patch: Partial<PaymentRow>) => {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addPayment = () => {
    const firstActive = activeMethods[0]?.name ?? '';
    setPayments((prev) => [...prev, { method: firstActive, amount: '' }]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!remark.trim()) {
      setError('Please enter a remark.');
      return;
    }

    setLoading(true);
    try {
      await paySettlement(settlementId, validPayments, remark.trim());
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h2>Make Payment</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          {vendorOwesOffice && (
            <div
              style={{
                background: 'var(--color-warning-bg, #fef3c7)',
                color: 'var(--color-warning-text, #92400e)',
                border: '1px solid var(--color-warning, #f59e0b)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '13px',
                marginBottom: '12px',
              }}
            >
              This vendor owes the office Rs. {expectedTotal.toLocaleString()} — the delivery charges exceeded the COD
              collected. Record the amount received <strong>from the vendor</strong> below.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <label style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              Payment Method
            </label>
            <Button type="button" variant="secondary" size="sm" onClick={addPayment}>
              + Add method
            </Button>
          </div>

          {payments.map((p, index) => (
            <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <select
                value={p.method}
                onChange={(e) => updatePayment(index, { method: e.target.value })}
                style={{ flex: '1 1 140px' }}
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
                onChange={(e) => updatePayment(index, { amount: e.target.value })}
                placeholder="Amount"
                style={{ flex: '1 1 140px' }}
              />
              {payments.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removePayment(index)}>
                  &times;
                </Button>
              )}
            </div>
          ))}

          {isSuperAdmin && (
            <div style={{ margin: '10px 0 4px' }}>
              <button
                type="button"
                onClick={() => setShowManage((s) => !s)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {showManage ? 'Hide' : 'Manage payment methods'}
              </button>

              {showManage && (
                <div
                  style={{
                    border: '1px solid var(--color-border, #e5e7eb)',
                    borderRadius: '8px',
                    padding: '10px',
                    marginTop: '8px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input
                      type="text"
                      value={newMethodName}
                      onChange={(e) => setNewMethodName(e.target.value)}
                      placeholder="New method (e.g. eSewa, Bank)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddMethod();
                        }
                      }}
                      style={{ flex: 1 }}
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
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 0',
                        fontSize: '13px',
                        opacity: m.isActive ? 1 : 0.55,
                      }}
                    >
                      <span>
                        {m.name}
                        {!m.isActive && (
                          <span style={{ color: 'var(--color-text-secondary)', marginLeft: '6px' }}>(disabled)</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleMethod(m)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: m.isActive ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {m.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  ))}

                  {methodError && (
                    <p className="error-text" style={{ marginTop: '6px' }}>
                      {methodError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', margin: '12px 0' }}>
            <span style={{ color: 'var(--color-primary)' }}>
              Total entered: Rs. {enteredAmount.toLocaleString()}
            </span>
            <span style={{ color: remainingAmount === 0 ? 'var(--color-success, green)' : 'var(--color-warning, #b45309)', fontWeight: 600 }}>
              Remaining payable: Rs. {remainingAmount.toLocaleString()}
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label>
              Remark
              <span className="required"> *</span>
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Enter a remark"
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MakePaymentModal;
