import React, { useState } from 'react';
import './Modal.css';
import Button from './Button';
import { revertSettlement, cancelSettlement } from '../services/finance.service';

interface RevertSettlementModalProps {
  settlementId: string;
  statementId: string;
  // "revert" undoes a mistaken payment (settled -> pending). "cancel" undoes a
  // statement that was never paid (pending -> cancelled), releasing its orders
  // for a future statement. Same remark-required confirmation UX either way.
  mode?: 'revert' | 'cancel';
  onClose: () => void;
  onSuccess: () => void;
}

const COPY = {
  revert: {
    title: 'Revert Settlement',
    warning: (statementId: string) => (
      <>
        This will move statement <strong>{statementId}</strong> back to Pending and mark every order in it as
        unpaid again. Use this only to undo a mistaken payment record — it does not move any actual money.
      </>
    ),
    reasonPlaceholder: 'Why is this statement being reverted?',
    submitLabel: 'Revert Settlement',
    submitLoadingLabel: 'Reverting...',
    errorFallback: 'Failed to revert settlement',
  },
  cancel: {
    title: 'Cancel Settlement',
    warning: (statementId: string) => (
      <>
        This will cancel statement <strong>{statementId}</strong> before it's been paid. Its orders are released so
        they can be bundled into a future statement — no money has moved for this statement, so there's nothing to
        undo financially.
      </>
    ),
    reasonPlaceholder: 'Why is this statement being cancelled?',
    submitLabel: 'Cancel Settlement',
    submitLoadingLabel: 'Cancelling...',
    errorFallback: 'Failed to cancel settlement',
  },
};

const RevertSettlementModal: React.FC<RevertSettlementModalProps> = ({
  settlementId,
  statementId,
  mode = 'revert',
  onClose,
  onSuccess,
}) => {
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[mode];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!remark.trim()) {
      setError(`Please explain why this statement is being ${mode === 'revert' ? 'reverted' : 'cancelled'}.`);
      return;
    }

    setLoading(true);
    try {
      const action = mode === 'revert' ? revertSettlement : cancelSettlement;
      await action(settlementId, remark.trim());
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || copy.errorFallback);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2>{copy.title}</h2>
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
            {copy.warning(statementId)}
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
              placeholder={copy.reasonPlaceholder}
              required
              autoFocus
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              {mode === 'cancel' ? 'Go Back' : 'Cancel'}
            </Button>
            <Button type="submit" variant="danger" disabled={loading}>
              {loading ? copy.submitLoadingLabel : copy.submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RevertSettlementModal;
