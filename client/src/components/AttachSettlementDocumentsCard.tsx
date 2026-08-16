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
  /** Tie the upload to one instalment, so the proof sits with the payment it evidences. */
  paymentId?: string;
  /** Swap the file behind an existing document instead of adding another one. */
  replaceDocumentId?: string;
  onDone: () => void;
  onDismiss?: () => void;
}

// The proof a payout actually happened only exists once the payout has
// happened — so this is deliberately its own step, not bundled into the
// payment form. Used both as the Make Payment flow's second step and as the
// statement detail page's "attach it later" affordance.
//
// Uploads add to whatever proof the statement already carries rather than
// replacing it: a payout paid in instalments needs a receipt per instalment,
// and one transfer can be worth photographing twice. `replaceDocumentId` is
// the exception, for swapping out a wrong or unreadable file.
const AttachSettlementDocumentsCard: React.FC<AttachSettlementDocumentsCardProps> = ({
  settlementId,
  title = 'Attach proof',
  caption = 'Add the receipt or tax invoice as evidence the transfer went through. Optional — you can attach it later from the statement.',
  submitLabel = 'Save documents',
  dismissLabel,
  only,
  paymentId,
  replaceDocumentId,
  onDone,
  onDismiss,
}) => {
  const [paymentReceipts, setPaymentReceipts] = useState<File[]>([]);
  const [taxInvoices, setTaxInvoices] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const showReceipt = only !== 'taxInvoice';
  const showInvoice = only !== 'receipt';
  // A replacement swaps exactly one file, so the picker stays single-slot.
  const allowMultiple = !replaceDocumentId;

  const receipts = showReceipt ? paymentReceipts : [];
  const invoices = showInvoice ? taxInvoices : [];
  const totalFiles = receipts.length + invoices.length;
  const tooManyForReplace = Boolean(replaceDocumentId) && totalFiles > 1;

  const handleSubmit = async () => {
    if (totalFiles === 0 || tooManyForReplace) return;
    setSaving(true);
    setError('');
    try {
      await attachSettlementDocuments(
        settlementId,
        { paymentReceipt: receipts, taxInvoice: invoices },
        {
          ...(paymentId ? { paymentId } : {}),
          ...(replaceDocumentId ? { replaceDocumentId } : {}),
        },
      );
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to attach documents');
    } finally {
      setSaving(false);
    }
  };

  const fileHint = (base: string) =>
    allowMultiple
      ? `${base} · JPG, PNG, WebP or PDF · max 5 MB each · add up to 5`
      : `${base} · JPG, PNG, WebP or PDF · max 5 MB`;

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
        {showReceipt &&
          (allowMultiple ? (
            <FileField
              multiple
              label="Payment receipt"
              hint={fileHint('Bank slip or wallet screenshot')}
              files={paymentReceipts}
              onChange={setPaymentReceipts}
            />
          ) : (
            <FileField
              label="Payment receipt"
              hint={fileHint('Bank slip or wallet screenshot')}
              file={paymentReceipts[0] ?? null}
              onChange={(file) => setPaymentReceipts(file ? [file] : [])}
            />
          ))}
        {showInvoice &&
          (allowMultiple ? (
            <FileField
              multiple
              label="Tax invoice"
              hint={fileHint('Invoice raised against this payout')}
              files={taxInvoices}
              onChange={setTaxInvoices}
            />
          ) : (
            <FileField
              label="Tax invoice"
              hint={fileHint('Invoice raised against this payout')}
              file={taxInvoices[0] ?? null}
              onChange={(file) => setTaxInvoices(file ? [file] : [])}
            />
          ))}
      </div>

      {tooManyForReplace && (
        <div className="asd-error" role="alert">
          A replacement takes a single file — remove the extras, or cancel and add them separately.
        </div>
      )}

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
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={totalFiles === 0 || tooManyForReplace || saving}
        >
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </section>
  );
};

export default AttachSettlementDocumentsCard;
