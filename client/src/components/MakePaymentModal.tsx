import React, { useState } from 'react';
import './Modal.css';
import Button from './Button';
import { paySettlement } from '../services/finance.service';

interface MakePaymentModalProps {
  settlementId: string;
  payableAmount: number;
  onClose: () => void;
  onSuccess: () => void;
}

const MakePaymentModal: React.FC<MakePaymentModalProps> = ({
  settlementId,
  payableAmount,
  onClose,
  onSuccess,
}) => {
  const [payments, setPayments] = useState<Array<{ method: 'cash' | 'online'; amount: string }>>([
    { method: 'cash', amount: String(payableAmount) },
  ]);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const enteredAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const remainingAmount = payableAmount - enteredAmount;

  const updatePayment = (index: number, patch: Partial<{ method: 'cash' | 'online'; amount: string }>) => {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const addPayment = () => {
    setPayments((prev) => [...prev, { method: 'online', amount: '' }]);
  };

  const removePayment = (index: number) => {
    setPayments((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
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
    if (Math.round(remainingAmount * 100) !== 0) {
      setError(`Payment total must equal Rs. ${payableAmount.toLocaleString()} (remaining Rs. ${remainingAmount.toLocaleString()}).`);
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
                onChange={(e) => updatePayment(index, { method: e.target.value as 'cash' | 'online' })}
                style={{ flex: '1 1 140px' }}
              >
                <option value="cash">Cash</option>
                <option value="online">Online</option>
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
