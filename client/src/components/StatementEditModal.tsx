import React, { useEffect, useState } from 'react';
import Button from './Button';
import { apiErrorMessage } from '../utils/serverValidation';
import './Modal.css';
import './EditSettlementModal.css';
import '../pages/SettlementCreatePage.css';

/** One order as the edit window lists it. `amount` is what it contributes to the statement. */
export interface EditableOrder {
  id: string;
  trackingId: string;
  receiverName: string;
  amount: number;
}

interface StatementEditModalProps {
  currentOrders: EditableOrder[];
  /** Orders that could join this statement - eligible and on no other one. */
  loadAddable: () => Promise<{ orders: EditableOrder[]; capped?: boolean }>;
  amountLabel: string;
  /** Who the statement is for, as the empty state names them: "vendor", "branch", "carrier". */
  payeeNoun: string;
  /** What the statement totals with these orders. Defaults to the sum of their amounts. */
  totalOf?: (selected: EditableOrder[]) => number;
  /** Saves the orders the statement will hold, in display order. */
  onSave: (selected: EditableOrder[]) => Promise<void>;
  onClose: () => void;
  onSuccess: () => void;
  /** A column after the amount, e.g. an editable charge. */
  extraColumn?: { header: string; render: (order: EditableOrder, selected: EditableOrder[]) => React.ReactNode };
  /** Shown above the order tables, e.g. charge inputs that apply to every order. */
  children?: React.ReactNode;
}

const money = (value: number) => `Rs. ${value.toLocaleString()}`;

/**
 * Edit an unpaid statement: untick an order to drop it, tick one below to add
 * it. The statement types differ only in what an order is worth and how the
 * change is saved, which the caller supplies.
 */
const StatementEditModal: React.FC<StatementEditModalProps> = ({
  currentOrders,
  loadAddable,
  amountLabel,
  payeeNoun,
  totalOf = (selected) => selected.reduce((sum, order) => sum + order.amount, 0),
  onSave,
  onClose,
  onSuccess,
  extraColumn,
  children,
}) => {
  const [keptIds, setKeptIds] = useState<Set<string>>(() => new Set(currentOrders.map((order) => order.id)));
  const [addable, setAddable] = useState<EditableOrder[]>([]);
  const [addableCapped, setAddableCapped] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [fetchingOrders, setFetchingOrders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadAddable()
      .then((result) => {
        if (!active) return;
        setAddable(result.orders);
        setAddableCapped(!!result.capped);
      })
      .catch(() => active && setAddable([]))
      .finally(() => active && setFetchingOrders(false));
    return () => {
      active = false;
    };
    // Loaded once per opening; the caller's loader is not expected to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = [
    ...currentOrders.filter((order) => keptIds.has(order.id)),
    ...addable.filter((order) => addedIds.has(order.id)),
  ];

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (selected.length === 0) {
      setError('A statement must include at least one order.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(selected);
      onSuccess();
      onClose();
    } catch (err) {
      // A caller's own check throws a plain Error; the API's come back as a response.
      const fromApi = (err as { response?: unknown })?.response !== undefined;
      setError(!fromApi && err instanceof Error ? err.message : apiErrorMessage(err, 'Failed to update the statement'));
    } finally {
      setSubmitting(false);
    }
  };

  const orderTable = (orders: EditableOrder[], isChecked: (id: string) => boolean, onToggle: (id: string) => void, highlight: (id: string) => boolean) => (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }} />
            <th style={{ textAlign: 'left' }}>Tracking ID</th>
            <th style={{ textAlign: 'left' }}>Receiver</th>
            <th style={{ textAlign: 'right' }}>{amountLabel}</th>
            {extraColumn && <th style={{ textAlign: 'right' }}>{extraColumn.header}</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className={highlight(order.id) ? 'scp-row-selected' : ''} onClick={() => onToggle(order.id)}>
              <td>
                <input
                  type="checkbox"
                  checked={isChecked(order.id)}
                  onChange={() => onToggle(order.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </td>
              <td className="scp-mono">{order.trackingId}</td>
              <td>{order.receiverName}</td>
              <td style={{ textAlign: 'right' }}>{money(order.amount)}</td>
              {extraColumn && (
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  {extraColumn.render(order, selected)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-content esm-modal-content">
        <div className="modal-header">
          <h2>Edit Statement</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <p className="esm-intro">
            Correct a mistake in this unsettled statement — remove an order that shouldn't be here, or add one that's
            missing. This is only possible before payment is recorded.
          </p>

          {children}

          <div className="esm-section">
            <label className="scp-label">Currently included ({currentOrders.length})</label>
            {currentOrders.length === 0 ? (
              <div className="scp-empty">No orders in this statement.</div>
            ) : (
              orderTable(
                currentOrders,
                (id) => keptIds.has(id),
                (id) => toggle(setKeptIds, id),
                (id) => !keptIds.has(id),
              )
            )}
            <p className="esm-hint">Uncheck an order to remove it from the statement.</p>
          </div>

          <div className="esm-section">
            <label className="scp-label">Add other unsettled orders</label>
            {fetchingOrders ? (
              <div className="scp-empty">Loading orders...</div>
            ) : addable.length === 0 ? (
              <div className="scp-empty">No other unsettled orders for this {payeeNoun}.</div>
            ) : (
              orderTable(
                addable,
                (id) => addedIds.has(id),
                (id) => toggle(setAddedIds, id),
                (id) => addedIds.has(id),
              )
            )}
            {addableCapped && (
              <p className="esm-hint">Showing the first {addable.length.toLocaleString()} eligible orders.</p>
            )}
          </div>

          <div className="scp-summary">
            <span>
              {selected.length} order{selected.length === 1 ? '' : 's'} in statement
            </span>
            <span className="scp-summary-total">Total: {money(totalOf(selected))}</span>
          </div>

          {error && <p className="error-text esm-error">{error}</p>}

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

export default StatementEditModal;
