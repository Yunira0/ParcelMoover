import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { PriceLogEntry } from '../../services/orders.service';
import { toBsDate } from '../../utils/nepaliDate';

const FIELD_LABELS: Record<PriceLogEntry['field'], string> = {
  cod: 'COD Amount',
  delivery_charge: 'Delivery Charge',
};

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

interface OrderPriceLogProps {
  entries: PriceLogEntry[];
}

/**
 * Read-only ledger of every COD / delivery-charge adjustment made to this order
 * after creation (sourced from the UPDATE_ORDER audit trail). Lets a vendor see
 * exactly what changed, by how much, when, and who made the change.
 */
const OrderPriceLog: React.FC<OrderPriceLogProps> = ({ entries }) => {
  if (entries.length === 0) {
    return <div className="od-pricelog-empty">No COD or delivery-charge changes have been made to this order.</div>;
  }

  return (
    <div className="od-pricelog-table-wrap">
      <table className="od-pricelog-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Change</th>
            <th>By</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{FIELD_LABELS[entry.field]}</td>
              <td>
                <span className="od-pricelog-change">
                  <span className="od-pricelog-old">{money(entry.oldValue)}</span>
                  <ArrowRight size={13} className="od-pricelog-arrow" aria-label="changed to" />
                  <span className="od-pricelog-new">{money(entry.newValue)}</span>
                </span>
              </td>
              <td>{entry.changedBy}</td>
              <td className="od-pricelog-date">{toBsDate(entry.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OrderPriceLog;
