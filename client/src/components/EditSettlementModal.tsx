import React, { useEffect, useMemo, useState } from 'react';
import Button from './Button';
import {
  getUnsettledOrders,
  updateSettlement,
  type PayeeType,
  type SettlementDetailItem,
  type UnsettledOrderItem,
} from '../services/finance.service';
import './Modal.css';
import '../pages/SettlementCreatePage.css';

interface EditSettlementModalProps {
  settlementId: string;
  payeeType: PayeeType;
  payeeId: string;
  currentItems: SettlementDetailItem[];
  onClose: () => void;
  onSuccess: () => void;
}

const EditSettlementModal: React.FC<EditSettlementModalProps> = ({
  settlementId,
  payeeType,
  payeeId,
  currentItems,
  onClose,
  onSuccess,
}) => {
  const [keptIds, setKeptIds] = useState<Set<string>>(
    () => new Set(currentItems.map((item) => item.codCollectionId)),
  );
  const [addableOrders, setAddableOrders] = useState<UnsettledOrderItem[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [fetchingOrders, setFetchingOrders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getUnsettledOrders(payeeType, payeeId)
      .then((res) => {
        if (active && res?.success) setAddableOrders(res.data.items);
      })
      .catch(() => {
        if (active) setAddableOrders([]);
      })
      .finally(() => {
        if (active) setFetchingOrders(false);
      });
    return () => {
      active = false;
    };
  }, [payeeType, payeeId]);

  const toggleKept = (codCollectionId: string) => {
    setKeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(codCollectionId)) next.delete(codCollectionId);
      else next.add(codCollectionId);
      return next;
    });
  };

  const toggleAdded = (codCollectionId: string) => {
    setAddedIds((prev) => {
      const next = new Set(prev);
      if (next.has(codCollectionId)) next.delete(codCollectionId);
      else next.add(codCollectionId);
      return next;
    });
  };

  const keptItems = useMemo(
    () => currentItems.filter((item) => keptIds.has(item.codCollectionId)),
    [currentItems, keptIds],
  );
  const addedOrders = useMemo(
    () => addableOrders.filter((order) => addedIds.has(order.codCollectionId)),
    [addableOrders, addedIds],
  );

  const totalPayable =
    keptItems.reduce(
      (sum, item) => sum + (payeeType === 'vendor' ? item.collectedAmount - item.deliveryCharge : item.collectedAmount),
      0,
    ) + addedOrders.reduce((sum, order) => sum + order.netPayable, 0);

  const finalCount = keptItems.length + addedOrders.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const codCollectionIds = [...keptIds, ...addedIds];
    if (codCollectionIds.length === 0) {
      setError('A statement must include at least one order.');
      return;
    }

    setSubmitting(true);
    try {
      await updateSettlement(settlementId, codCollectionIds);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update settlement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h2>Edit Statement</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-caption)', margin: '0 0 var(--space-4)' }}>
            Correct a mistake in this unsettled statement — remove an order that shouldn't be here, or add one that's
            missing. This is only possible before payment is recorded.
          </p>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="scp-label">Currently included ({currentItems.length})</label>
            {currentItems.length === 0 ? (
              <div className="scp-empty">No orders in this statement.</div>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }} />
                      <th style={{ textAlign: 'left' }}>Tracking ID</th>
                      <th style={{ textAlign: 'left' }}>Receiver</th>
                      <th style={{ textAlign: 'right' }}>
                        {payeeType === 'vendor' ? 'Net Payable' : 'Collected'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.map((item) => (
                      <tr
                        key={item.codCollectionId}
                        className={keptIds.has(item.codCollectionId) ? '' : 'scp-row-selected'}
                        onClick={() => toggleKept(item.codCollectionId)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={keptIds.has(item.codCollectionId)}
                            onChange={() => toggleKept(item.codCollectionId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="scp-mono">{item.trackingId}</td>
                        <td>{item.receiverName}</td>
                        <td style={{ textAlign: 'right' }}>
                          Rs.{' '}
                          {(payeeType === 'vendor'
                            ? item.collectedAmount - item.deliveryCharge
                            : item.collectedAmount
                          ).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: '12px', color: 'var(--color-text-caption)', margin: 'var(--space-2) 0 0' }}>
              Uncheck an order to remove it from the statement.
            </p>
          </div>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="scp-label">Add other unsettled orders</label>
            {fetchingOrders ? (
              <div className="scp-empty">Loading orders...</div>
            ) : addableOrders.length === 0 ? (
              <div className="scp-empty">No other unsettled orders for this {payeeType}.</div>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }} />
                      <th style={{ textAlign: 'left' }}>Tracking ID</th>
                      <th style={{ textAlign: 'left' }}>Receiver</th>
                      <th style={{ textAlign: 'right' }}>
                        {payeeType === 'vendor' ? 'Net Payable' : 'Collected'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {addableOrders.map((order) => (
                      <tr
                        key={order.codCollectionId}
                        className={addedIds.has(order.codCollectionId) ? 'scp-row-selected' : ''}
                        onClick={() => toggleAdded(order.codCollectionId)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={addedIds.has(order.codCollectionId)}
                            onChange={() => toggleAdded(order.codCollectionId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="scp-mono">{order.trackingId}</td>
                        <td>{order.receiverName}</td>
                        <td style={{ textAlign: 'right' }}>Rs. {order.netPayable.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="scp-summary">
            <span>{finalCount} order{finalCount === 1 ? '' : 's'} in statement</span>
            <span className="scp-summary-total">Total: Rs. {totalPayable.toLocaleString()}</span>
          </div>

          {error && (
            <p className="error-text" style={{ marginTop: 'var(--space-3)' }}>
              {error}
            </p>
          )}

          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || fetchingOrders}>
              {submitting ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditSettlementModal;
