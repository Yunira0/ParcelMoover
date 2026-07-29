import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { RedirectLogEntry } from '../../services/orders.service';
import { toBsDateTime } from '../../utils/nepaliDate';

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`;

interface OrderRedirectLogProps {
  entries: RedirectLogEntry[];
}

/**
 * Read-only trail of every destination change made because the customer moved.
 * Each row keeps the branch/address it came from, why it moved, and what the
 * diversion cost — the charges are snapshots, so old rows stay accurate even
 * after the vendor's rates change.
 */
const OrderRedirectLog: React.FC<OrderRedirectLogProps> = ({ entries }) => {
  if (entries.length === 0) {
    return <div className="od-pricelog-empty">This order has never been redirected.</div>;
  }

  return (
    <div className="od-pricelog-table-wrap">
      <table className="od-pricelog-table">
        <thead>
          <tr>
            <th>Destination</th>
            <th>Address</th>
            <th>Reason</th>
            <th>Charge</th>
            <th>By</th>
            <th>Date (B.S.)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <span className="od-pricelog-change">
                  <span className="od-pricelog-old">{entry.fromBranch || '—'}</span>
                  <ArrowRight size={13} className="od-pricelog-arrow" aria-label="redirected to" />
                  <span className="od-pricelog-new">{entry.toBranch}</span>
                </span>
              </td>
              <td>{entry.toAddress || '—'}</td>
              <td>{entry.reason}</td>
              <td>
                <span className="od-pricelog-change">
                  <span className="od-pricelog-old">{money(entry.oldDeliveryCharge)}</span>
                  <ArrowRight size={13} className="od-pricelog-arrow" aria-label="changed to" />
                  <span className="od-pricelog-new">{money(entry.newDeliveryCharge)}</span>
                </span>
              </td>
              <td>{entry.redirectedBy}</td>
              <td className="od-pricelog-date">{toBsDateTime(entry.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OrderRedirectLog;
