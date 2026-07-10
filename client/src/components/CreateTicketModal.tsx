import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import './Modal.css';
import './CreateTicketModal.css';
import FormField from './FormField';
import Button from './Button';
import {
  createTicket,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  type CreateTicketInput,
  type TicketCategory,
  type TicketPriority,
} from '../services/tickets.service';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface TicketFormState {
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  numberOfParcels: string;
  pickupSlot: string;
  orderIds: string[];
}

const initialState: TicketFormState = {
  category: 'general',
  priority: 'medium',
  subject: '',
  description: '',
  bankName: '',
  accountNumber: '',
  accountName: '',
  numberOfParcels: '',
  pickupSlot: '',
  orderIds: [''],
};

// Pickup slots close 1 hour before they END (e.g. the 9 AM–12 PM slot is
// bookable until 11 AM), with the final slot capped at 6 PM. `cutoff` is
// minutes-since-midnight; a slot is selectable while the current time is before it.
const PICKUP_SLOTS = [
  { value: '9-12', label: '9 AM – 12 PM', cutoff: 11 * 60 },
  { value: '2-5', label: '2 PM – 5 PM', cutoff: 16 * 60 },
  { value: '5-8', label: '5 PM – 8 PM', cutoff: 18 * 60 },
];

// Latest cutoff across all slots — past this, nothing is bookable today.
const LAST_PICKUP_CUTOFF = 18 * 60;

const priorityOptions = (Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((p) => ({
  value: p,
  label: TICKET_PRIORITY_LABELS[p],
}));

const categoryOptions = (Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map((c) => ({
  value: c,
  label: TICKET_CATEGORY_LABELS[c],
}));

const CreateTicketModal: React.FC<CreateTicketModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [form, setForm] = useState<TicketFormState>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Tick every minute so slot availability stays in sync with the real clock
  // even if the modal is left open across a cutoff.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Drop a chosen slot the moment its cutoff passes.
  useEffect(() => {
    if (form.category !== 'pickup' || !form.pickupSlot) return;
    const slot = PICKUP_SLOTS.find((s) => s.value === form.pickupSlot);
    if (slot && nowMinutes >= slot.cutoff) {
      setForm((prev) => ({ ...prev, pickupSlot: '' }));
    }
  }, [nowMinutes, form.category, form.pickupSlot]);

  if (!isOpen) return null;

  const update = (patch: Partial<TicketFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const updateOrderId = (index: number, value: string) => {
    setForm((prev) => {
      const orderIds = [...prev.orderIds];
      orderIds[index] = value;
      return { ...prev, orderIds };
    });
  };

  const addOrderId = () => setForm((prev) => ({ ...prev, orderIds: [...prev.orderIds, ''] }));

  const removeOrderId = (index: number) => {
    setForm((prev) => ({
      ...prev,
      orderIds: prev.orderIds.length > 1 ? prev.orderIds.filter((_, i) => i !== index) : prev.orderIds,
    }));
  };

  // Each category maps onto the shared ticket model: we always produce a
  // `subject` and fold the category-specific fields into `description`.
  const buildPayload = (): { payload: CreateTicketInput } | { error: string } => {
    const { category, priority, subject, description } = form;

    if (category === 'general') {
      if (!subject.trim() || !description.trim()) return { error: 'Please fill in all fields.' };
      return { payload: { category, priority, subject: subject.trim(), description: description.trim() } };
    }

    if (category === 'cod_settlement') {
      const { bankName, accountNumber, accountName } = form;
      if (!bankName.trim() || !accountNumber.trim() || !accountName.trim() || !description.trim()) {
        return { error: 'Please fill in all fields.' };
      }
      const composed = [
        `Bank Name: ${bankName.trim()}`,
        `Account Number: ${accountNumber.trim()}`,
        `Account Name: ${accountName.trim()}`,
        '',
        description.trim(),
      ].join('\n');
      return { payload: { category, priority, subject: 'COD Settlement request', description: composed } };
    }

    if (category === 'pickup') {
      const { numberOfParcels, pickupSlot } = form;
      if (!numberOfParcels.trim() || Number(numberOfParcels) <= 0 || !pickupSlot) {
        return { error: 'Please fill in all fields.' };
      }
      const slot = PICKUP_SLOTS.find((s) => s.value === pickupSlot);
      if (!slot || nowMinutes >= slot.cutoff) {
        return { error: 'That pickup slot is no longer available. Please pick another.' };
      }
      const composed = `No. of parcels: ${numberOfParcels.trim()}\nPickup time: ${slot.label}`;
      return { payload: { category, subject: 'Pickup request', description: composed } };
    }

    // delivery
    const cleanedIds = form.orderIds.map((id) => id.trim()).filter(Boolean);
    if (cleanedIds.length === 0) return { error: 'Add at least one order ID.' };
    if (!description.trim()) return { error: 'Please fill in all fields.' };
    return {
      payload: {
        category: 'delivery',
        priority,
        subject: `Delivery issue — ${cleanedIds.length} order${cleanedIds.length === 1 ? '' : 's'}`,
        description: `Order IDs: ${cleanedIds.join(', ')}\n\n${description.trim()}`,
      },
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const result = buildPayload();
    if ('error' in result) {
      setError(result.error);
      return;
    }

    setLoading(true);
    try {
      await createTicket(result.payload);
      setForm(initialState);
      onSuccess();
      onClose();
    } catch (err: any) {
      const data = err.response?.data;
      const firstErr = data?.errors?.[0];
      const msg = firstErr?.message || data?.message || 'Failed to create ticket';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const showPriority = form.category !== 'pickup';

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Create Ticket</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>&times;</Button>
        </div>
        <form onSubmit={handleSubmit} className="ticket-form">
          <FormField
            label="Category"
            type="select"
            className="ticket-category-field"
            value={form.category}
            onChange={(value) => update({ category: value as TicketCategory })}
            options={categoryOptions}
          />

          <div className="ticket-fields">
            {form.category === 'general' && (
              <FormField
                label="Subject"
                required
                className="ticket-field-full"
                value={form.subject}
                onChange={(value) => update({ subject: value })}
              />
            )}

            {form.category === 'cod_settlement' && (
              <>
                <FormField
                  label="Bank Name"
                  required
                  value={form.bankName}
                  onChange={(value) => update({ bankName: value })}
                />
                <FormField
                  label="Account Number"
                  required
                  value={form.accountNumber}
                  onChange={(value) => update({ accountNumber: value })}
                />
                <FormField
                  label="Account Name"
                  required
                  className="ticket-field-full"
                  value={form.accountName}
                  onChange={(value) => update({ accountName: value })}
                />
              </>
            )}

            {form.category === 'pickup' && (
              <>
                <FormField
                  label="No. of Parcels"
                  type="number"
                  min={1}
                  required
                  value={form.numberOfParcels}
                  onChange={(value) => update({ numberOfParcels: value })}
                />
                <div className="form-group">
                  <label htmlFor="pickup-slot">Pickup Time<span className="required">*</span></label>
                  <select
                    id="pickup-slot"
                    required
                    value={form.pickupSlot}
                    onChange={(e) => update({ pickupSlot: e.target.value })}
                    className={form.pickupSlot ? undefined : 'placeholder-selected'}
                  >
                    <option value="">Select a slot</option>
                    {PICKUP_SLOTS.map((slot) => {
                      const available = nowMinutes < slot.cutoff;
                      return (
                        <option key={slot.value} value={slot.value} disabled={!available}>
                          {slot.label}{available ? '' : ' — closed'}
                        </option>
                      );
                    })}
                  </select>
                  {nowMinutes >= LAST_PICKUP_CUTOFF && (
                    <small className="ticket-slot-note">No pickup slots left for today.</small>
                  )}
                </div>
              </>
            )}

            {form.category === 'delivery' && (
              <div className="ticket-orderids">
                <label>Order IDs<span className="required">*</span></label>
                {form.orderIds.map((orderId, index) => (
                  <div className="ticket-orderid-row" key={index}>
                    <input
                      value={orderId}
                      onChange={(e) => updateOrderId(index, e.target.value)}
                      placeholder={`Order ID ${index + 1}`}
                    />
                    {form.orderIds.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOrderId(index)}
                        aria-label="Remove order ID"
                      >
                        <X size={16} />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="ticket-add-orderid" onClick={addOrderId}>
                  <Plus size={14} /> Add order ID
                </Button>
              </div>
            )}

            {showPriority && (
              <FormField
                label="Priority"
                type="select"
                required
                value={form.priority}
                onChange={(value) => update({ priority: value as TicketPriority })}
                options={priorityOptions}
              />
            )}

            {form.category !== 'pickup' && (
              <FormField
                label="Description"
                type="textarea"
                required
                className="ticket-field-full"
                value={form.description}
                onChange={(value) => update({ description: value })}
              />
            )}
          </div>

          {error && <p className="error-text">{error}</p>}
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Ticket'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTicketModal;
