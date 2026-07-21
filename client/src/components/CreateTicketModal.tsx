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
import { getActivePickupTimeSlots, type PickupTimeSlot } from '../services/pickupTimeSlots.service';
import { getCurrentUserRoles } from '../utils/auth';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pre-select a category when opened from a deep link (e.g. dashboard quick actions). */
  initialCategory?: TicketCategory;
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
  pickupDate: 'today' | 'tomorrow';
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
  pickupDate: 'today',
  orderIds: [''],
};

const priorityOptions = (Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((p) => ({
  value: p,
  label: TICKET_PRIORITY_LABELS[p],
}));

const categoryOptions = (Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map((c) => ({
  value: c,
  label: TICKET_CATEGORY_LABELS[c],
}));

const CreateTicketModal: React.FC<CreateTicketModalProps> = ({ isOpen, onClose, onSuccess, initialCategory }) => {
  const [form, setForm] = useState<TicketFormState>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Super admins book pickups on a vendor's behalf and aren't bound by the
  // same-day cutoff — they can pick any slot for today or tomorrow.
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');

  // Slots are admin-configurable (Settings → Pickup Time Slots) rather than hardcoded.
  const [slots, setSlots] = useState<PickupTimeSlot[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    getActivePickupTimeSlots()
      .then((res) => { if (res?.success) setSlots(res.data); })
      .catch(() => {});
  }, [isOpen]);

  // Latest cutoff across all slots — past this, nothing is bookable today.
  const lastPickupCutoff = slots.length ? Math.max(...slots.map((s) => s.cutoffMinutes)) : 0;

  useEffect(() => {
    if (isOpen && initialCategory) {
      setForm((prev) => ({ ...prev, category: initialCategory }));
    }
  }, [isOpen, initialCategory]);
  // Tick every minute so slot availability stays in sync with the real clock
  // even if the modal is left open across a cutoff.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Vendors are auto-rescheduled to tomorrow once every slot today has
  // closed; super admins are never forced off "today".
  useEffect(() => {
    if (isSuperAdmin || form.category !== 'pickup' || slots.length === 0) return;
    if (nowMinutes >= lastPickupCutoff && form.pickupDate === 'today') {
      setForm((prev) => ({ ...prev, pickupDate: 'tomorrow', pickupSlot: '' }));
    }
  }, [nowMinutes, form.category, form.pickupDate, isSuperAdmin, slots.length, lastPickupCutoff]);

  // Drop a chosen slot the moment its cutoff passes (today only — a
  // tomorrow slot, or any slot picked by a super admin, never expires here).
  useEffect(() => {
    if (form.category !== 'pickup' || !form.pickupSlot) return;
    if (isSuperAdmin || form.pickupDate !== 'today') return;
    const slot = slots.find((s) => s.id === form.pickupSlot);
    if (slot && nowMinutes >= slot.cutoffMinutes) {
      setForm((prev) => ({ ...prev, pickupSlot: '' }));
    }
  }, [nowMinutes, form.category, form.pickupSlot, form.pickupDate, isSuperAdmin, slots]);

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
      const { numberOfParcels, pickupSlot, pickupDate } = form;
      if (!numberOfParcels.trim() || Number(numberOfParcels) <= 0 || !pickupSlot) {
        return { error: 'Please fill in all fields.' };
      }
      const slot = slots.find((s) => s.id === pickupSlot);
      if (!slot) return { error: 'Please pick a pickup slot.' };
      const restrictedByCutoff = !isSuperAdmin && pickupDate === 'today';
      if (restrictedByCutoff && nowMinutes >= slot.cutoffMinutes) {
        return { error: 'That pickup slot is no longer available. Please pick another.' };
      }
      const dateLabel = pickupDate === 'tomorrow' ? 'Tomorrow' : 'Today';
      const composed = `No. of parcels: ${numberOfParcels.trim()}\nPickup date: ${dateLabel}\nPickup time: ${slot.label}`;
      return { payload: { category, subject: 'Pickup request', description: composed } };
    }

    if (category === 'loss_and_damage') {
      const cleanedIds = form.orderIds.map((id) => id.trim()).filter(Boolean);
      if (cleanedIds.length === 0) return { error: 'Add at least one order ID.' };
      if (!description.trim()) return { error: 'Please fill in all fields.' };
      return {
        payload: {
          category,
          priority,
          subject: `Loss & damage — ${cleanedIds.length} order${cleanedIds.length === 1 ? '' : 's'}`,
          description: `Order IDs: ${cleanedIds.join(', ')}\n\n${description.trim()}`,
        },
      };
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
                  <label htmlFor="pickup-date">Pickup Date<span className="required">*</span></label>
                  {isSuperAdmin ? (
                    <select
                      id="pickup-date"
                      value={form.pickupDate}
                      onChange={(e) => update({ pickupDate: e.target.value as 'today' | 'tomorrow' })}
                    >
                      <option value="today">Today</option>
                      <option value="tomorrow">Tomorrow</option>
                    </select>
                  ) : (
                    <input id="pickup-date" type="text" readOnly disabled value={form.pickupDate === 'tomorrow' ? 'Tomorrow' : 'Today'} />
                  )}
                </div>
                <div className="form-group">
                  <label htmlFor="pickup-slot">Pickup Time<span className="required">*</span></label>
                  <select
                    id="pickup-slot"
                    required
                    value={form.pickupSlot}
                    onChange={(e) => update({ pickupSlot: e.target.value })}
                    className={form.pickupSlot ? undefined : 'placeholder-selected'}
                  >
                    <option value="">{slots.length ? 'Select a slot' : 'No slots configured'}</option>
                    {slots.map((slot) => {
                      const restrictedByCutoff = !isSuperAdmin && form.pickupDate === 'today';
                      const available = !restrictedByCutoff || nowMinutes < slot.cutoffMinutes;
                      return (
                        <option key={slot.id} value={slot.id} disabled={!available}>
                          {slot.label}{available ? '' : ' — closed'}
                        </option>
                      );
                    })}
                  </select>
                  {!isSuperAdmin && form.pickupDate === 'tomorrow' && (
                    <small className="ticket-slot-note">No pickup slots left for today — rescheduled for tomorrow.</small>
                  )}
                </div>
              </>
            )}

            {(form.category === 'delivery' || form.category === 'loss_and_damage') && (
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
