import React, { useState } from 'react';
import './Modal.css';
import Button from './Button';
import { revertSettlement } from '../services/finance.service';

interface RevertSettlementModalProps {
  settlementId: string;
  statementId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const RevertSettlementModal: React.FC<RevertSettlementModalProps> = ({
  settlementId,
  statementId,
  onClose,
  onSuccess,
}) => {
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!remark.trim()) {
      setError('Please explain why this statement is being reverted.');
      return;
    }

    setLoading(true);
    try {
      await revertSettlement(settlementId, remark.trim());
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to revert settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2>Revert Settlement</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div
            style={{
              background: 'var(--color-warning-bg, #fef3c7)',
              color: 'var(--color-warning-text, #92400e)',
              border: '1px solid var(--color-warning, #f59e0b)',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            This will move statement <strong>{statementId}</strong> back to Pending and mark every order in it as
            unpaid again. Use this only to undo a mistaken payment record — it does not move any actual money.
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label>
              Reason
              <span className="required"> *</span>
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Why is this statement being reverted?"
              required
              autoFocus
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={loading}>
              {loading ? 'Reverting...' : 'Revert Settlement'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RevertSettlementModal;
