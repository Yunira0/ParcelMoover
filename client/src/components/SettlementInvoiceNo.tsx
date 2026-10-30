import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import Button from './Button';
import FormField from './FormField';
import { setSettlementInvoiceNo } from '../services/finance.service';
import { apiErrorMessage } from '../utils/serverValidation';
import './SettlementInvoiceNo.css';

interface SettlementInvoiceNoProps {
  settlementId: string;
  invoiceNo: string | null;
  canEdit: boolean;
  onSaved: () => void;
}

/** The vendor's invoice number for a payout, as one statement meta row, editable in place by finance staff. */
const SettlementInvoiceNo: React.FC<SettlementInvoiceNoProps> = ({ settlementId, invoiceNo, canEdit, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(invoiceNo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cancel = () => {
    setValue(invoiceNo ?? '');
    setError('');
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setSettlementInvoiceNo(settlementId, value);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save invoice number'));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="sin-edit">
        <FormField
          label="Invoice no."
          value={value}
          onChange={setValue}
          maxLength={64}
          placeholder="e.g. INV-2083-0142"
          error={error || undefined}
        />
        <div className="sin-actions">
          <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <span>Invoice no.</span>
      <span>
        {invoiceNo || '-'}
        {canEdit && (
          <Button size="icon" variant="ghost" className="sin-edit-btn" onClick={() => setEditing(true)} aria-label="Edit invoice number">
            <Pencil size={13} />
          </Button>
        )}
      </span>
    </div>
  );
};

export default SettlementInvoiceNo;
