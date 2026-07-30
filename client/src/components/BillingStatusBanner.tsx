import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { getBillingStatus, type BillingStatus } from '../services/billing.service';
import { isVendorSide } from '../utils/auth';
import { formatCurrency } from '../utils/format';
import '../pages/vendor/VendorBilling.css';

/**
 * Warns a vendor about outstanding delivery charges, and tells a blocked one
 * why order creation is refused before they fill in a form.
 *
 * Presentation only — the block is enforced server-side in
 * assertVendorCanCreateOrder. Hiding a button is never the control.
 *
 * Renders nothing for non-vendor actors, for a healthy account, or if the
 * request fails: a billing lookup hiccup must not take a page down with it.
 */
const BillingStatusBanner: React.FC = () => {
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    if (!isVendorSide()) return;

    let active = true;
    getBillingStatus()
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        // Non-fatal; the page it sits on has its own job to do.
      });

    return () => {
      active = false;
    };
  }, []);

  if (!status || status.state === 'ok') return null;

  const owed = Math.max(0, -status.balance);

  return (
    <div className={`billing-banner billing-banner-${status.state}`}>
      <AlertTriangle size={18} />
      <div>
        <strong>
          {status.state === 'blocked' ? 'Order creation is paused' : 'Delivery charges are due'}
        </strong>
        <p>
          {status.state === 'blocked'
            ? `${formatCurrency(owed)} is outstanding. Pay at least ${formatCurrency(
                status.amountToClearBlock,
              )} to resume placing orders.`
            : `${formatCurrency(owed)} is outstanding. Order creation pauses at ${formatCurrency(
                Math.abs(status.blockThreshold),
              )} outstanding.`}{' '}
          <Link to="/finance/billing">Pay now</Link>
        </p>
      </div>
    </div>
  );
};

export default BillingStatusBanner;
