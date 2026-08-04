import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Upload } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import {
  getBillingStatus,
  listVendorPayments,
  submitVendorPayment,
  type BillingStatus,
  type VendorPayment,
} from '../../services/billing.service';
import { formatCurrency } from '../../utils/format';
import { toBsDate } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import './VendorFinance.css';
import './VendorBilling.css';

// Doc/QR paths are stored relative ("uploads/billing/x.jpg") and served off the
// API origin, which is not the same as the SPA origin in dev.
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
const uploadUrl = (path: string) =>
  `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;

const STATUS_LABEL: Record<VendorPayment['status'], string> = {
  pending: 'Awaiting verification',
  verified: 'Verified',
  rejected: 'Rejected',
};

const VendorBilling: React.FC = () => {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // null = the vendor hasn't touched the field, so it shows the suggested
  // amount below. Derived at render rather than synced in via an effect.
  const [amount, setAmount] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, paymentsData] = await Promise.all([
        getBillingStatus(),
        listVendorPayments({ pageSize: 20 }),
      ]);
      setStatus(statusData);
      setPayments(paymentsData.data);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load billing details.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // What the vendor most likely wants to pay: enough to lift a block, or the
  // whole outstanding balance if they're only warned.
  const suggestedAmount =
    status && status.state !== 'ok'
      ? (status.state === 'blocked' ? status.amountToClearBlock : Math.abs(status.balance)).toFixed(2)
      : '';
  const amountValue = amount ?? suggestedAmount;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSubmitted('');

    const parsed = Number(amountValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError('Enter the amount you paid.');
      return;
    }

    setSubmitting(true);
    try {
      await submitVendorPayment({ amount: parsed, reference, note, proof });
      setSubmitted('Payment submitted. It will be credited once our team verifies it.');
      setAmount(null);
      setReference('');
      setNote('');
      setProof(null);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Failed to submit payment.'));
    } finally {
      setSubmitting(false);
    }
  };

  const owed = status ? Math.max(0, -status.balance) : 0;

  return (
    <div className="vendor-finance-page">
      <PageHeader
        title="Billing & Payments"
        subtitle="Your account balance with us, and how to clear outstanding delivery charges."
      />

      {loading ? (
        <div className="loading-state">Loading billing details...</div>
      ) : error ? (
        <p className="vendor-finance-error">{error}</p>
      ) : !status ? (
        <div className="loading-state">No billing details available.</div>
      ) : (
        <>
          {status.state !== 'ok' && (
            <div className={`billing-banner billing-banner-${status.state}`}>
              <AlertTriangle size={18} />
              <div>
                <strong>
                  {status.state === 'blocked'
                    ? 'Order creation is paused'
                    : 'Delivery charges are due'}
                </strong>
                <p>
                  {status.state === 'blocked'
                    ? `${formatCurrency(owed)} is outstanding. Pay at least ${formatCurrency(
                        status.amountToClearBlock,
                      )} to resume placing orders.`
                    : `${formatCurrency(owed)} is outstanding. Order creation pauses at ${formatCurrency(
                        Math.abs(status.blockThreshold),
                      )} outstanding.`}
                </p>
              </div>
            </div>
          )}

          <div className="billing-grid">
            <section className="billing-card">
              <h3>Account balance</h3>
              <div className="billing-breakdown">
                <div>
                  <span>COD collected</span>
                  <span>{formatCurrency(status.codCollected)}</span>
                </div>
                <div>
                  <span>Delivery charges</span>
                  <span className="billing-debit">-{formatCurrency(status.deliveryCharges)}</span>
                </div>
                <div className="billing-breakdown-total">
                  <span>Due delivery charge</span>
                  <span className={owed > 0 ? 'billing-debit' : ''}>{formatCurrency(owed)}</span>
                </div>
              </div>
              {status.pendingPaymentAmount > 0 && (
                <p className="billing-hint">
                  <Clock size={14} /> {formatCurrency(status.pendingPaymentAmount)} submitted and
                  awaiting verification — not yet reflected above.
                </p>
              )}
            </section>

            <section className="billing-card">
              <h3>Pay delivery charges</h3>
              {status.paymentQrPath ? (
                <img
                  className="billing-qr"
                  src={uploadUrl(status.paymentQrPath)}
                  alt="Scan to pay via Fonepay"
                />
              ) : (
                <p className="billing-hint">
                  No payment QR has been configured yet. Please contact support to arrange payment.
                </p>
              )}
              {status.paymentNote && <p className="billing-hint">{status.paymentNote}</p>}

              <form className="billing-form" onSubmit={handleSubmit}>
                <label>
                  Amount paid
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountValue}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={submitting}
                  />
                </label>
                <label>
                  Transaction reference
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="From your payment app"
                    disabled={submitting}
                  />
                </label>
                <label>
                  Note (optional)
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={submitting}
                  />
                </label>
                <label className="billing-file">
                  <Upload size={14} />
                  {proof ? proof.name : 'Attach payment screenshot (optional)'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    disabled={submitting}
                  />
                </label>

                {formError && <p className="vendor-finance-error">{formError}</p>}
                {submitted && <p className="billing-success">{submitted}</p>}

                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'I have paid'}
                </Button>
                <p className="billing-hint">
                  Payments are credited once our team matches them against our statement.
                </p>
              </form>
            </section>
          </div>

          <section className="billing-card">
            <h3>Payment history</h3>
            {payments.length === 0 ? (
              <p className="billing-hint">No payments submitted yet.</p>
            ) : (
              <table className="cod-bill-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{toBsDate(payment.createdAt)}</td>
                      <td>{formatCurrency(payment.amount)}</td>
                      <td>{payment.reference || '—'}</td>
                      <td>
                        <span className={`billing-pill billing-pill-${payment.status}`}>
                          {payment.status === 'verified' && <CheckCircle2 size={12} />}
                          {payment.status === 'pending' && <Clock size={12} />}
                          {STATUS_LABEL[payment.status]}
                        </span>
                      </td>
                      <td>{payment.reviewRemark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default VendorBilling;
