import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import './Modal.css';
import './ConfirmDialog.css';
import Button from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Optional second line — the consequence, not a restatement of the title. */
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive and shows the warning icon. */
  danger?: boolean;
  /** Disables both buttons while the action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An in-app replacement for window.confirm.
 *
 * Cancel is deliberately the focused button on open: for a destructive prompt
 * the safe choice should be the one an accidental Enter lands on. Escape and a
 * click on the backdrop both cancel, so there is no way to dismiss this dialog
 * that results in the action running.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="modal-content confirm-dialog"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="confirm-dialog-body">
          {danger && (
            <span className="confirm-dialog-icon" aria-hidden="true">
              <AlertTriangle size={20} />
            </span>
          )}
          <div>
            <h2 className="confirm-dialog-title" id="confirm-dialog-title">{title}</h2>
            {message && <p className="confirm-dialog-message">{message}</p>}
          </div>
        </div>

        <div className="confirm-dialog-actions">
          {/* autoFocus rather than a ref: Button is a plain function component
              and doesn't forward one. */}
          <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
