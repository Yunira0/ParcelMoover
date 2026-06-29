import React, { useState, useEffect } from 'react';
import './Modal.css';
import Button from './Button';
import { getUnsettledOrders, type UnsettledOrderItem } from '../services/finance.service';
import { getRiders, getVendors } from '../services/users.service';

interface AddSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (settlement: {
    id: string;
    sn: number;
    statementId: string;
    name: string;
    amount: number;
    settlementDate: string;
    remark: string;
    status: 'pending' | 'settled' | 'review';
    type: 'rider' | 'vendor';
    phone: string;
    email: string;
  }) => void;
  defaultType: 'rider' | 'vendor';
  existingCount: number;
}

const AddSettlementModal: React.FC<AddSettlementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultType,
  existingCount,
}) => {
  const [entityOptions, setEntityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedEntityName, setSelectedEntityName] = useState('');
  const [orders, setOrders] = useState<UnsettledOrderItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchingOrders, setFetchingOrders] = useState(false);
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSelectedEntityId('');
    setSelectedEntityName('');
    setSelected(new Set());
    setOrders([]);
    setSettlementDate(new Date().toISOString().split('T')[0]);
    setRemark('');
    setError('');

    const fetchEntities = async () => {
      setFetching(true);
      try {
        if (defaultType === 'rider') {
          const res = await getRiders();
          if (res?.success && Array.isArray(res.data)) {
            setEntityOptions(res.data.map((r: any) => ({
              value: r.id,
              label: r.name || r.client_name || '',
            })));
          }
        } else {
          const res = await getVendors();
          if (res?.success && Array.isArray(res.data)) {
            setEntityOptions(res.data.map((v: any) => ({
              value: v.id,
              label: v.company || v.client || '',
            })));
          }
        }
      } catch {
        setEntityOptions([]);
      } finally {
        setFetching(false);
      }
    };
    fetchEntities();
  }, [isOpen, defaultType]);

  useEffect(() => {
    if (!selectedEntityId) {
      setOrders([]);
      setSelected(new Set());
      return;
    }

    const fetchOrders = async () => {
      setFetchingOrders(true);
      try {
        const res = await getUnsettledOrders(defaultType, selectedEntityId);
        if (res?.success && res.data?.items) {
          setOrders(res.data.items);
        } else {
          setOrders([]);
        }
      } catch {
        setOrders([]);
      } finally {
        setFetchingOrders(false);
      }
    };
    fetchOrders();
  }, [selectedEntityId, defaultType]);

  if (!isOpen) return null;

  const prefix = defaultType === 'rider' ? 'STM-R' : 'STM-V';
  const year = new Date().getFullYear();
  const nextNum = String(existingCount + 1).padStart(3, '0');
  const autoId = `${prefix}-${year}-${nextNum}`;

  const toggleOrder = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.id)));
    }
  };

  const selectedOrders = orders.filter((o) => selected.has(o.id));
  const totalAmount = defaultType === 'vendor'
    ? selectedOrders.reduce((sum, o) => sum + o.netPayable, 0)
    : selectedOrders.reduce((sum, o) => sum + o.codAmount, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!selectedEntityId) {
      setError(`Please select a ${defaultType}.`);
      setLoading(false);
      return;
    }

    if (selected.size === 0) {
      setError('Please select at least one order.');
      setLoading(false);
      return;
    }

    onSuccess({
      id: `${prefix}-${year}-${Date.now()}`,
      sn: 0,
      statementId: autoId,
      name: selectedEntityName,
      amount: totalAmount,
      settlementDate,
      remark: remark.trim(),
      status: 'pending',
      type: defaultType,
      phone: '',
      email: '',
    });

    setLoading(false);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '720px' }}>
        <div className="modal-header">
          <h2>Add Settlement</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 200px' }}>
              <label>
                {defaultType === 'rider' ? 'Rider' : 'Vendor'}
                <span className="required"> *</span>
              </label>
              <select
                value={selectedEntityId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedEntityId(id);
                  const opt = entityOptions.find((o) => o.value === id);
                  setSelectedEntityName(opt?.label || '');
                  setSelected(new Set());
                }}
                disabled={fetching}
              >
                <option value="">{fetching ? 'Loading...' : `Select ${defaultType}`}</option>
                {entityOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 160px' }}>
              <label>Statement ID</label>
              <input type="text" value={autoId} disabled style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group" style={{ flex: '1 1 160px' }}>
              <label>Settlement Date</label>
              <input
                type="date"
                value={settlementDate}
                onChange={(e) => setSettlementDate(e.target.value)}
              />
            </div>
          </div>

          {selectedEntityId && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Unsettled Orders ({orders.length})
                </label>
              </div>

              {fetchingOrders ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-caption)' }}>
                  Loading orders...
                </div>
              ) : orders.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-caption)' }}>
                  No unsettled orders found for this {defaultType}.
                </div>
              ) : (
                <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px', marginBottom: '16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-muted)', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', width: '40px' }}>
                          <input
                            type="checkbox"
                            checked={selected.size === orders.length && orders.length > 0}
                            onChange={toggleAll}
                          />
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>Tracking ID</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>Receiver</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>COD</th>
                        {defaultType === 'vendor' && (
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Delivery Charge</th>
                        )}
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {defaultType === 'vendor' ? 'Net Payable' : 'Amount'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.id}
                          style={{
                            borderTop: '1px solid var(--color-border)',
                            cursor: 'pointer',
                            background: selected.has(order.id) ? 'var(--color-primary-bg)' : 'transparent',
                          }}
                          onClick={() => toggleOrder(order.id)}
                        >
                          <td style={{ padding: '8px 12px' }}>
                            <input
                              type="checkbox"
                              checked={selected.has(order.id)}
                              onChange={() => toggleOrder(order.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px' }}>
                            {order.trackingId}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{order.receiverName}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            Rs. {order.codAmount.toLocaleString()}
                          </td>
                          {defaultType === 'vendor' && (
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              Rs. {order.deliveryCharge.toLocaleString()}
                            </td>
                          )}
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                            Rs. {(defaultType === 'vendor' ? order.netPayable : order.codAmount).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {selected.size > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--color-primary-bg)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
              <span>{selected.size} order{selected.size > 1 ? 's' : ''} selected</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>
                Total: Rs. {totalAmount.toLocaleString()}
              </span>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label>Remark</label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Optional note"
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading || fetching || !selectedEntityId}>
              {loading ? 'Adding...' : 'Add Settlement'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddSettlementModal;
