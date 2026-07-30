import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Table from '../components/Table';
import Button from '../components/Button';
import { getCurrentUserRoles } from '../utils/auth';
import {
  getBillingSettings,
  listVendorBalances,
  listVendorPayments,
  reviewVendorPayment,
  updateBillingSettings,
  uploadPaymentQr,
  type BillingSettings,
  type VendorBalanceRow,
  type VendorPayment,
} from '../services/billing.service';
import { formatCurrency } from '../utils/format';
import { toBsDate } from '../utils/nepaliDate';
import { apiErrorMessage } from '../utils/serverValidation';
import './vendor/VendorBilling.css';
import './BillingManagement.css';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
const uploadUrl = (path: string) =>
  `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;

type Tab = 'queue' | 'vendors' | 'settings';

const TAB_LABELS: Record<Tab, string> = {
  queue: 'Payment verification',
  vendors: 'Vendor balances',
  settings: 'Thresholds & QR',
};

const BillingManagement: React.FC = () => {
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');

  const [activeTab, setActiveTab] = useState<Tab>('queue');
  const [error, setError] = useState('');

  // Verification queue
  const [claims, setClaims] = useState<VendorPayment[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  // Vendor balances
  const [balances, setBalances] = useState<VendorBalanceRow[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Settings
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [warn, setWarn] = useState('');
  const [block, setBlock] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  const loadClaims = useCallback(async () => {
    setClaimsLoading(true);
    try {
      const res = await listVendorPayments({ status: 'pending', pageSize: 50 });
      setClaims(res.data);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load payment claims.'));
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      setBalances(await listVendorBalances());
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load vendor balances.'));
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await getBillingSettings();
      setSettings(data);
      setWarn(String(data.warnThreshold));
      setBlock(String(data.blockThreshold));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load billing settings.'));
    }
  }, []);

  useEffect(() => {
    void loadClaims();
    void loadSettings();
  }, [loadClaims, loadSettings]);

  useEffect(() => {
    if (activeTab === 'vendors' && balances.length === 0) void loadBalances();
  }, [activeTab, balances.length, loadBalances]);

  const handleReview = async (payment: VendorPayment, decision: 'verified' | 'rejected') => {
    setReviewing(payment.id);
    setError('');
    try {
      await reviewVendorPayment(payment.id, decision, remarks[payment.id]);
      await loadClaims();
      // A verification changes the vendor's balance, so any loaded report is stale.
      if (balances.length > 0) await loadBalances();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to review payment.'));
    } finally {
      setReviewing(null);
    }
  };

  const handleSaveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsMessage('');
    setError('');
    try {
      const updated = await updateBillingSettings({
        warnThreshold: Number(warn),
        blockThreshold: Number(block),
      });
      setSettings(updated);
      setSettingsMessage('Thresholds saved.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save thresholds.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleQrUpload = async (file: File) => {
    setError('');
    try {
      setSettings(await uploadPaymentQr(file));
      setSettingsMessage('Payment QR updated.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to upload QR.'));
    }
  };

  const claimColumns = [
    { header: 'DATE', accessor: (p: VendorPayment) => toBsDate(p.createdAt) || '—', width: '110px' },
    { header: 'VENDOR', accessor: (p: VendorPayment) => p.vendorName, width: '180px' },
    { header: 'AMOUNT', accessor: (p: VendorPayment) => formatCurrency(p.amount), width: '120px' },
    { header: 'REFERENCE', accessor: (p: VendorPayment) => p.reference || '—', width: '160px' },
    {
      header: 'PROOF',
      accessor: (p: VendorPayment) =>
        p.proofPath ? (
          <a href={uploadUrl(p.proofPath)} target="_blank" rel="noreferrer" className="billing-doc-link">
            <FileText size={14} /> View <ExternalLink size={12} />
          </a>
        ) : (
          '—'
        ),
      width: '110px',
    },
    { header: 'NOTE', accessor: (p: VendorPayment) => p.note || '—', width: '160px' },
    {
      header: 'DECISION',
      accessor: (p: VendorPayment) => (
        <div className="billing-review-cell">
          <input
            placeholder="Remark (required to reject)"
            value={remarks[p.id] ?? ''}
            onChange={(e) => setRemarks((prev) => ({ ...prev, [p.id]: e.target.value }))}
            disabled={reviewing === p.id}
          />
          <div className="billing-review-actions">
            <Button
              variant="primary"
              onClick={() => handleReview(p, 'verified')}
              disabled={reviewing === p.id}
            >
              Verify
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleReview(p, 'rejected')}
              disabled={reviewing === p.id}
            >
              Reject
            </Button>
          </div>
        </div>
      ),
      width: '300px',
    },
  ];

  // Table keys rows off `id`; the API returns the vendor key as `vendorId`.
  type BalanceTableRow = VendorBalanceRow & { id: string };
  const balanceRows: BalanceTableRow[] = balances.map((v) => ({ ...v, id: v.vendorId }));

  const balanceColumns = [
    { header: 'VENDOR', accessor: (v: VendorBalanceRow) => v.vendorName, width: '200px' },
    {
      header: 'BALANCE',
      accessor: (v: VendorBalanceRow) => (
        <span className={v.balance < 0 ? 'billing-debit' : ''}>{formatCurrency(v.balance)}</span>
      ),
      width: '130px',
    },
    { header: 'COD COLLECTED', accessor: (v: VendorBalanceRow) => formatCurrency(v.codCollected), width: '140px' },
    { header: 'CHARGES', accessor: (v: VendorBalanceRow) => formatCurrency(v.deliveryCharges), width: '120px' },
    { header: 'PAID OUT', accessor: (v: VendorBalanceRow) => formatCurrency(v.payouts), width: '120px' },
    { header: 'RECEIVED', accessor: (v: VendorBalanceRow) => formatCurrency(v.paymentsReceived), width: '120px' },
    {
      header: 'STATE',
      accessor: (v: VendorBalanceRow) => (
        <span className={`billing-pill billing-pill-${v.state === 'ok' ? 'verified' : v.state === 'warned' ? 'pending' : 'rejected'}`}>
          {v.state}
        </span>
      ),
      width: '110px',
    },
  ];

  return (
    <div className="vendor-finance-page">
      <PageHeader
        title="Billing & Credit Control"
        subtitle="Verify vendor payments, review outstanding balances, and set the credit thresholds."
      />

      <SegmentedTabs
        ariaLabel="Billing sections"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as Tab[]).map((tab) => ({
          value: tab,
          label: TAB_LABELS[tab],
          ...(tab === 'queue' ? { count: claims.length } : {}),
        }))}
      />

      {error && <p className="vendor-finance-error">{error}</p>}

      {activeTab === 'queue' && (
        <Table
          columns={claimColumns}
          data={claims}
          loading={claimsLoading}
          loadingMessage="Loading payment claims..."
          emptyMessage="No payments awaiting verification."
          minWidth="1200px"
        />
      )}

      {activeTab === 'vendors' && (
        <>
          <p className="billing-hint">
            Live balances for every vendor. Check this before enforcement goes live — anyone already
            past the block threshold will be unable to place orders the moment it does.
          </p>
          <Table
            columns={balanceColumns}
            data={balanceRows}
            loading={balancesLoading}
            loadingMessage="Calculating vendor balances..."
            emptyMessage="No vendors found."
            minWidth="1040px"
          />
        </>
      )}

      {activeTab === 'settings' && (
        <div className="billing-grid">
          <section className="billing-card">
            <h3>Credit thresholds</h3>
            <p className="billing-hint">
              Both are negative: the account balance at which each rule trips. A vendor is notified
              at the warn threshold and can no longer create orders at the block threshold.
            </p>
            <form className="billing-form" onSubmit={handleSaveSettings}>
              <label>
                Warn threshold
                <input
                  type="number"
                  step="0.01"
                  value={warn}
                  onChange={(e) => setWarn(e.target.value)}
                  disabled={!isSuperAdmin || savingSettings}
                />
              </label>
              <label>
                Block threshold
                <input
                  type="number"
                  step="0.01"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  disabled={!isSuperAdmin || savingSettings}
                />
              </label>
              {settingsMessage && <p className="billing-success">{settingsMessage}</p>}
              {isSuperAdmin ? (
                <Button type="submit" variant="primary" disabled={savingSettings}>
                  {savingSettings ? 'Saving...' : 'Save thresholds'}
                </Button>
              ) : (
                <p className="billing-hint">Only a super admin can change these.</p>
              )}
            </form>
          </section>

          <section className="billing-card">
            <h3>Payment QR</h3>
            <p className="billing-hint">Shown to every vendor on their billing page.</p>
            {settings?.paymentQrPath ? (
              <img className="billing-qr" src={uploadUrl(settings.paymentQrPath)} alt="Payment QR" />
            ) : (
              <p className="billing-hint">No QR uploaded yet.</p>
            )}
            {isSuperAdmin && (
              <label className="billing-file">
                Upload a new QR
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleQrUpload(file);
                  }}
                />
              </label>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
