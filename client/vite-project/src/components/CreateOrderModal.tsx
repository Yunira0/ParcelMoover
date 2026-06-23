import React, { useEffect, useState } from 'react';
import './Modal.css';
import './CreateOrderModal.css';
import { createOrder, type CreateOrderInput, type OrderType, type ServiceType } from '../services/orders.service';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: CreateOrderInput | null;
  mode?: 'create' | 'copy' | 'edit';
}

const defaultForm: CreateOrderInput = {
  sender: { name: '', phone: '', email: '', address: '' },
  receiver: { name: '', phone: '', email: '', address: '' },
  orderType: 'delivery',
  serviceType: 'dtd',
  pieces: 1,
  weightKg: undefined,
  codAmount: 0,
  deliveryCharge: 0,
  pickupAddress: '',
};

const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialData = null,
  mode = 'create',
}) => {
  const [formData, setFormData] = useState<CreateOrderInput>(initialData || defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData || defaultForm);
      setError('');
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const setSender = (field: string, value: string) =>
    setFormData(prev => ({ ...prev, sender: { ...prev.sender, [field]: value } }));

  const setReceiver = (field: string, value: string) =>
    setFormData(prev => ({ ...prev, receiver: { ...prev.receiver, [field]: value } }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await createOrder(formData);
      setFormData(defaultForm);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content order-modal-content">
        <div className="modal-header">
          <h2>{mode === 'copy' ? 'Copy Order' : mode === 'edit' ? 'Edit Order' : 'Create New Order'}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="order-form">

          {/* Order Config */}
          <div className="order-section-title">Order Details</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Order Type</label>
              <select
                value={formData.orderType}
                onChange={e => setFormData(p => ({ ...p, orderType: e.target.value as OrderType }))}
              >
                <option value="delivery">Delivery</option>
                <option value="exchange">Exchange</option>
                <option value="return">Return</option>
              </select>
            </div>
            <div className="form-group">
              <label>Service Type</label>
              <select
                value={formData.serviceType}
                onChange={e => setFormData(p => ({ ...p, serviceType: e.target.value as ServiceType }))}
              >
                <option value="dtd">Door to Door (DTD)</option>
                <option value="btd">Branch to Door (BTD)</option>
                <option value="btb">Branch to Branch (BTB)</option>
                <option value="dtb">Door to Branch (DTB)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Pieces</label>
              <input
                type="number"
                min={1}
                required
                value={formData.pieces}
                onChange={e => setFormData(p => ({ ...p, pieces: Number(e.target.value) }))}
              />
            </div>
            <div className="form-group">
              <label>Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                value={formData.weightKg ?? ''}
                onChange={e => setFormData(p => ({ ...p, weightKg: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="Optional"
              />
            </div>
            <div className="form-group">
              <label>COD Amount (Rs.)</label>
              <input
                type="number"
                min={0}
                value={formData.codAmount}
                onChange={e => setFormData(p => ({ ...p, codAmount: Number(e.target.value) }))}
              />
            </div>
            <div className="form-group">
              <label>Delivery Charge (Rs.)</label>
              <input
                type="number"
                min={0}
                value={formData.deliveryCharge}
                onChange={e => setFormData(p => ({ ...p, deliveryCharge: Number(e.target.value) }))}
              />
            </div>
            <div className="form-group form-full">
              <label>Pickup Address</label>
              <input
                type="text"
                value={formData.pickupAddress}
                onChange={e => setFormData(p => ({ ...p, pickupAddress: e.target.value }))}
                placeholder="Enter pickup address"
              />
            </div>
          </div>

          {/* Sender */}
          <div className="order-section-title">Sender Info</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" required value={formData.sender.name} onChange={e => setSender('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Phone *</label>
              <input type="text" required value={formData.sender.phone} onChange={e => setSender('phone', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={formData.sender.email} onChange={e => setSender('email', e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Address</label>
              <input type="text" value={formData.sender.address} onChange={e => setSender('address', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* Receiver */}
          <div className="order-section-title">Receiver Info</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" required value={formData.receiver.name} onChange={e => setReceiver('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Phone *</label>
              <input type="text" required value={formData.receiver.phone} onChange={e => setReceiver('phone', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={formData.receiver.email} onChange={e => setReceiver('email', e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Address</label>
              <input type="text" value={formData.receiver.address} onChange={e => setReceiver('address', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="cancel-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? 'Creating...' : mode === 'copy' ? 'Create Copy' : mode === 'edit' ? 'Save as New Order' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateOrderModal;
