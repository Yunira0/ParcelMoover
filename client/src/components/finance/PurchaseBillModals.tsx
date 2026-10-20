import React, { useState } from 'react';
import Button from '../Button';
import FormField from '../FormField';
import NepaliDatePicker from '../NepaliDatePicker';
import { cancelPurchaseBill, createPurchaseBill, type PurchaseType } from '../../services/vatRegister.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { formatAmount } from '../../utils/format';
import { todayNepalAd } from '../../utils/nepaliDate';
import '../Modal.css';
import { Toast } from '../toast';

const VAT_RATE = 13;

const PURCHASE_TYPES: { value: PurchaseType; label: string }[] = [
  { value: 'local', label: 'Local purchase' },
  { value: 'import', label: 'Import' },
  { value: 'capital', label: 'Capital purchase / import' },
];

interface AddProps {
  onClose: () => void;
  onSaved: () => void;
}

/** A supplier's bill (rent, fuel, equipment...) for the Purchase Register. Amounts include VAT. */
export const AddPurchaseBillModal: React.FC<AddProps> = ({ onClose, onSaved }) => {
  const [form, setForm] = useState({
    billDate: todayNepalAd(),
    billNo: '',
    customsNo: '',
    supplierName: '',
    supplierPan: '',
    purchaseType: 'local' as PurchaseType,
    description: '',
    totalAmount: '',
    exemptAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const total = Number(form.totalAmount) || 0;
  const exempt = Number(form.exemptAmount) || 0;
  const taxable = Math.round(((total - exempt) * 100 * 100) / (100 + VAT_RATE)) / 100;
  const vat = Math.round((total - exempt - taxable) * 100) / 100;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.billNo.trim() || !form.supplierName.trim() || total <= 0) {
      setError('Enter the bill number, supplier name and total amount.');
      return;
    }
    if (exempt > total) {
      setError("The tax-exempt amount can't be more than the total.");
      return;
    }
    setSaving(true);
    try {
      await createPurchaseBill({
        billDate: form.billDate,
        billNo: form.billNo.trim(),
        customsNo: form.customsNo.trim() || undefined,
        supplierName: form.supplierName.trim(),
        supplierPan: form.supplierPan.trim() || undefined,
        purchaseType: form.purchaseType,
        description: form.description.trim() || undefined,
        totalAmount: total,
        exemptAmount: exempt,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to add the purchase bill'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: '560px' }}>
        <div className="modal-header">
          <h2>Add purchase bill</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>
              Bill date (BS)
            </label>
            <NepaliDatePicker value={form.billDate} max={todayNepalAd()} onChange={set('billDate')} aria-label="Bill date" />
          </div>
          <FormField label="Bill no." required value={form.billNo} onChange={set('billNo')} maxLength={64} />
          <FormField label="Supplier name" required value={form.supplierName} onChange={set('supplierName')} maxLength={200} />
          <FormField label="Supplier PAN" value={form.supplierPan} onChange={set('supplierPan')} maxLength={9} placeholder="9 digits" />
          <FormField
            label="Purchase type"
            type="select"
            value={form.purchaseType}
            onChange={(value) => set('purchaseType')(value)}
            options={PURCHASE_TYPES}
          />
          {form.purchaseType !== 'local' && (
            <FormField label="Customs declaration no." value={form.customsNo} onChange={set('customsNo')} maxLength={64} />
          )}
          <FormField label="Description" value={form.description} onChange={set('description')} maxLength={200} placeholder="e.g. Office rent, Bhadra" />
          <FormField label="Tax-exempt amount (Rs.)" type="decimal" value={form.exemptAmount} onChange={set('exemptAmount')} />
          <FormField
            label="Total amount incl. VAT (Rs.)"
            required
            type="decimal"
            value={form.totalAmount}
            onChange={set('totalAmount')}
            hint={`Taxable value Rs. ${formatAmount(Math.max(taxable, 0))} · VAT ${VAT_RATE}% Rs. ${formatAmount(Math.max(vat, 0))}`}
          />

          <Toast tone="error" message={error} onShown={() => setError('')} />

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving...' : 'Add bill'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CancelProps {
  billId: string;
  billNo: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Cancels a purchase bill; it then shows on the Purchase Return Register for the month it was cancelled. */
export const CancelPurchaseBillModal: React.FC<CancelProps> = ({ billId, billNo, onClose, onSaved }) => {
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!remark.trim()) {
      setError('Please give a reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await cancelPurchaseBill(billId, remark.trim());
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to cancel the purchase bill'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: '480px' }}>
        <div className="modal-header">
          <h2>Cancel purchase bill</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-warning-banner">
            Bill <strong>{billNo}</strong> will move to the Purchase Return Register for this month.
          </div>
          <FormField label="Reason" required value={remark} onChange={setRemark} maxLength={500} />
          <Toast tone="error" message={error} onShown={() => setError('')} />
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Go back
            </Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? 'Cancelling...' : 'Cancel bill'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
