import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import Button from './Button';
import FileField from './FileField';
import { attachSettlementDocuments } from '../services/finance.service';
import './AttachSettlementDocumentsCard.css';

interface AttachSettlementDocumentsCardProps {
  settlementId: string;
  title?: string;
  caption?: string;
  submitLabel?: string;
  /** Secondary action's label. Omit to hide the secondary action entirely. */
  dismissLabel?: string;
  /** Restrict to a single document field, e.g. when each document has its own tab. Omit to show both. */
  only?: 'receipt' | 'taxInvoice';
  onDone: () => void;
  onDismiss?: () => void;
}

// The proof a payout actually happened only exists once the payout has
// happened — so this is deliberately its own step, not bundled into the
// payment form. Used both as the Make Payment flow's second step and as the
// statement detail page's "attach it later" affordance.
const AttachSettlementDocumentsCard: React.FC<AttachSettlementDocumentsCardProps> = ({
  settlementId,
  title = 'Attach proof',
  caption = 'Add the receipt or tax invoice as evidence the transfer went through. Optional — you can attach it later from the statement.',
  submitLabel = 'Save documents',
  dismissLabel,
  only,
  onDone,
  onDismiss,
}) => {
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const [taxInvoice, setTaxInvoice] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const showReceipt = only !== 'taxInvoice';
  const showInvoice = only !== 'receipt';
  const hasFile = Boolean((showReceipt && paymentReceipt) || (showInvoice && taxInvoice));

  const handleSubmit = async () => {
    if (!hasFile) return;
    setSaving(true);
    setError('');
    try {
      await attachSettlementDocuments(settlementId, {
        paymentReceipt: showReceipt ? paymentReceipt : undefined,
        taxInvoice: showInvoice ? taxInvoice : undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to attach documents');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="asd-card">
      <div className="asd-card-header">
        <Paperclip size={16} className="asd-card-icon" />
        <div>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
      </div>

      <div className={`asd-files${only ? ' asd-files-single' : ''}`}>
        {showReceipt && (
          <FileField
            label="Payment receipt"
            hint="Bank slip or wallet screenshot · JPG, PNG, WebP or PDF · max 5 MB"
            file={paymentReceipt}
            onChange={setPaymentReceipt}
          />
        )}
        {showInvoice && (
          <FileField
            label="Tax invoice"
            hint="Invoice raised against this payout · JPG, PNG, WebP or PDF · max 5 MB"
            file={taxInvoice}
            onChange={setTaxInvoice}
          />
        )}
      </div>

      {error && (
        <div className="asd-error" role="alert">
          {error}
        </div>
      )}

      <div className="asd-actions">
        {dismissLabel && (
          <Button type="button" variant="secondary" onClick={onDismiss} disabled={saving}>
            {dismissLabel}
          </Button>
        )}
        <Button type="button" variant="primary" onClick={handleSubmit} disabled={!hasFile || saving}>
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </section>
  );
};

export default AttachSettlementDocumentsCard;
