import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import CreditUsageBar from '../components/CreditUsageBar';
import Table from '../components/Table';
import Button from '../components/Button';
import FileField from '../components/FileField';
import FormField from '../components/FormField';
import Pagination from '../components/Pagination';
import '../components/Modal.css';
import { getCurrentUserRoles } from '../utils/auth';
import {
  getBillingSettings,
  listVendorBalances,
  listVendorPayments,
  paymentQrUrl,
  reviewVendorPayment,
  updateBillingSettings,
  updateVendorCreditLimit,
  uploadPaymentQr,
  type BillingSettings,
  type VendorBalanceRow,
  type VendorPayment,
} from '../services/billing.service';
import { formatCurrency } from '../utils/format';
import { toBsDate } from '../utils/nepaliDate';
import { apiErrorMessage } from '../utils/serverValidation';
import './vendor/VendorFinance.css';
import './vendor/VendorBilling.css';
import './BillingManagement.css';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
const uploadUrl = (path: string) =>
  `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;

const isImagePath = (path: string) => /\.(jpe?g|png|webp|gif)$/i.test(path);

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
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [claimsTotalPages, setClaimsTotalPages] = useState(1);
  const [claimsPage, setClaimsPage] = useState(1);
  const [claimsPageSize, setClaimsPageSize] = useState(50);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  // Proof screenshots deserve a focused look while comparing them against the
  // claim's stated amount/reference — an inline preview beats losing the
  // queue's place to a new tab for every row.
  const [previewProof, setPreviewProof] = useState<string | null>(null);

  // Vendor balances
  const [balances, setBalances] = useState<VendorBalanceRow[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Settings
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [warn, setWarn] = useState('');
  const [defaultCredit, setDefaultCredit] = useState('');
  const [branchWarn, setBranchWarn] = useState('');
  const [branchBlock, setBranchBlock] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');

  // Per-vendor credit limit editor (super_admin only, like the thresholds).
  const [creditVendor, setCreditVendor] = useState<VendorBalanceRow | null>(null);
  const [creditValue, setCreditValue] = useState('');
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditError, setCreditError] = useState('');

  // QR replace is staged, not immediate: picking a file only previews it, so
  // a wrong click can't silently swap the QR every vendor pays against.
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrMessage, setQrMessage] = useState('');
  const [qrError, setQrError] = useState('');

  // Vendor-facing note shown right under the QR, e.g. "Fonepay to 98XX-XXXXXX".
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');
  const [noteError, setNoteError] = useState('');

  const loadClaims = useCallback(async () => {
    setClaimsLoading(true);
    try {
      const res = await listVendorPayments({ status: 'pending', page: claimsPage, pageSize: claimsPageSize });
      setClaims(res.data);
      setClaimsTotal(res.meta.total);
      setClaimsTotalPages(res.meta.totalPages);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load payment claims.'));
    } finally {
      setClaimsLoading(false);
    }
  }, [claimsPage, claimsPageSize]);

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
      setDefaultCredit(String(data.defaultCreditLimit));
      setBranchWarn(String(data.branchWarnThreshold));
      setBranchBlock(String(data.branchBlockThreshold));
      setNote(data.paymentNote ?? '');
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

  // Verifying/rejecting the last claim on a page (other than the first)
  // leaves claimsPage pointing past the end of the now-shorter queue.
  useEffect(() => {
    if (!claimsLoading && claims.length === 0 && claimsPage > 1) setClaimsPage(1);
  }, [claimsLoading, claims.length, claimsPage]);

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
    setSettingsError('');
    try {
      const updated = await updateBillingSettings({
        warnThreshold: Number(warn),
        defaultCreditLimit: Number(defaultCredit),
        branchWarnThreshold: Number(branchWarn),
        branchBlockThreshold: Number(branchBlock),
      });
      setSettings(updated);
      setSettingsMessage('Thresholds saved.');
    } catch (err) {
      setSettingsError(apiErrorMessage(err, 'Failed to save thresholds.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveNote = async () => {
    setSavingNote(true);
    setNoteMessage('');
    setNoteError('');
    try {
      const updated = await updateBillingSettings({ paymentNote: note.trim() || null });
      setSettings(updated);
      setNoteMessage('Note saved.');
    } catch (err) {
      setNoteError(apiErrorMessage(err, 'Failed to save note.'));
    } finally {
      setSavingNote(false);
    }
  };

  // Overrides one vendor's credit limit. Only that row changes — the system
  // default and every other vendor keep their values — and the list reloads
  // so the new state shows immediately.
  const openCreditEditor = (vendor: VendorBalanceRow) => {
    setCreditVendor(vendor);
    setCreditValue(String(vendor.creditLimit));
    setCreditError('');
  };

  const closeCreditEditor = () => {
    setCreditVendor(null);
    setCreditValue('');
    setCreditError('');
  };

  const handleSaveCredit = async () => {
    if (!creditVendor) return;
    setCreditSaving(true);
    setCreditError('');
    try {
      await updateVendorCreditLimit(creditVendor.vendorId, Number(creditValue));
      closeCreditEditor();
      await loadBalances();
    } catch (err) {
      setCreditError(apiErrorMessage(err, 'Failed to update credit limit.'));
    } finally {
      setCreditSaving(false);
    }
  };

  const handleQrUpload = async () => {
    if (!qrFile) return;
    setQrUploading(true);
    setQrError('');
    setQrMessage('');
    try {
      setSettings(await uploadPaymentQr(qrFile));
      setQrMessage('QR updated — vendors will see this immediately.');
      setQrFile(null);
    } catch (err) {
      setQrError(apiErrorMessage(err, 'Failed to upload QR.'));
    } finally {
      setQrUploading(false);
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
          isImagePath(p.proofPath) ? (
            <button
              type="button"
              className="billing-doc-link billing-doc-preview-btn"
              onClick={() => setPreviewProof(p.proofPath)}
            >
              <FileText size={14} /> View
            </button>
          ) : (
            <a href={uploadUrl(p.proofPath)} target="_blank" rel="noreferrer" className="billing-doc-link">
              <FileText size={14} /> View <ExternalLink size={12} />
            </a>
          )
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
      header: 'CREDIT LIMIT',
      accessor: (v: VendorBalanceRow) => (
        <span className="billing-limit-cell">
          <span className="billing-limit-row">
            {formatCurrency(v.creditLimit)}
            {isSuperAdmin && (
              <button
                type="button"
                className="billing-doc-link billing-doc-preview-btn"
                onClick={() => openCreditEditor(v)}
                aria-label={`Edit credit limit for ${v.vendorName}`}
              >
                Edit
              </button>
            )}
          </span>
          <CreditUsageBar balance={v.balance} creditLimit={v.creditLimit} state={v.state} />
        </span>
      ),
      width: '190px',
    },
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
      />

      <SegmentedTabs
        ariaLabel="Billing sections"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as Tab[]).map((tab) => ({
          value: tab,
          label: TAB_LABELS[tab],
          ...(tab === 'queue' ? { count: claimsTotal } : {}),
        }))}
      />

      {error && <p className="vendor-finance-error">{error}</p>}

      {activeTab === 'queue' && (
        <>
          <Table
            columns={claimColumns}
            data={claims}
            loading={claimsLoading}
            loadingMessage="Loading payment claims..."
            emptyMessage="No payments awaiting verification."
            minWidth="1200px"
          />
          <Pagination
            ariaLabel="Payment verification pagination"
            page={claimsPage}
            totalPages={claimsTotalPages}
            onPageChange={setClaimsPage}
            pageSize={claimsPageSize}
            pageSizeLabel="claims"
            onPageSizeChange={(size) => {
              setClaimsPageSize(size);
              setClaimsPage(1);
            }}
            summary={`${claimsTotal} claim${claimsTotal === 1 ? '' : 's'} awaiting verification`}
          />
        </>
      )}

      {activeTab === 'vendors' && (
        <>
          <p className="billing-hint">
            Live balances for every vendor, with the credit limit that blocks each
            one. A vendor whose owing passes their own limit cannot place new orders
            until a verified payment brings it back down.
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
              Warn is a negative account balance; the default credit limit is a positive cap.
              A vendor is warned past the warn line and blocked once what they owe passes
              their own credit limit. Branch thresholds pause transit into a branch with
              COD remittance overdue.
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
                Default credit limit (NPR)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={defaultCredit}
                  onChange={(e) => setDefaultCredit(e.target.value)}
                  disabled={!isSuperAdmin || savingSettings}
                />
              </label>
              <label>
                Branch warn threshold
                <input
                  type="number"
                  step="0.01"
                  value={branchWarn}
                  onChange={(e) => setBranchWarn(e.target.value)}
                  disabled={!isSuperAdmin || savingSettings}
                />
              </label>
              <label>
                Branch transit block threshold
                <input
                  type="number"
                  step="0.01"
                  value={branchBlock}
                  onChange={(e) => setBranchBlock(e.target.value)}
                  disabled={!isSuperAdmin || savingSettings}
                />
              </label>
              {settingsError && <p className="vendor-finance-error">{settingsError}</p>}
              {settingsMessage && (
                <p className="billing-success">
                  <CheckCircle2 size={14} /> {settingsMessage}
                </p>
              )}
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
              <img className="billing-qr" src={paymentQrUrl(settings.paymentQrPath)} alt="Current payment QR" />
            ) : (
              <p className="billing-hint">No QR uploaded yet.</p>
            )}

            <label className="billing-form-label">Note shown below the QR</label>
            <textarea
              className="billing-note-input"
              rows={2}
              maxLength={280}
              placeholder="e.g. Fonepay to 98XX-XXXXXX — ParcelMoover Pvt. Ltd."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!isSuperAdmin || savingNote}
            />
            {noteError && <p className="vendor-finance-error">{noteError}</p>}
            {noteMessage && (
              <p className="billing-success">
                <CheckCircle2 size={14} /> {noteMessage}
              </p>
            )}
            {isSuperAdmin && (
              <Button
                variant="secondary"
                onClick={handleSaveNote}
                disabled={savingNote || note.trim() === (settings?.paymentNote ?? '')}
              >
                {savingNote ? 'Saving...' : 'Save note'}
              </Button>
            )}

            {isSuperAdmin && (
              <>
                <FileField
                  label={settings?.paymentQrPath ? 'Replace with a new QR' : 'Upload a QR'}
                  hint="JPG, PNG, or WebP · max 5 MB"
                  file={qrFile}
                  onChange={(file) => {
                    setQrFile(file);
                    setQrError('');
                    setQrMessage('');
                  }}
                />
                {qrError && <p className="vendor-finance-error">{qrError}</p>}
                {qrMessage && (
                  <p className="billing-success">
                    <CheckCircle2 size={14} /> {qrMessage}
                  </p>
                )}
                {qrFile && (
                  <div className="billing-review-actions">
                    <Button variant="secondary" onClick={() => setQrFile(null)} disabled={qrUploading}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={handleQrUpload} disabled={qrUploading}>
                      {qrUploading ? 'Uploading...' : 'Replace QR'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {previewProof && (
        <div className="modal-overlay" onClick={() => setPreviewProof(null)}>
          <div className="billing-proof-modal" onClick={(e) => e.stopPropagation()}>
            <div className="billing-proof-modal-header">
              <span>Payment proof</span>
              <button
                type="button"
                className="billing-proof-modal-close"
                onClick={() => setPreviewProof(null)}
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <img src={uploadUrl(previewProof)} alt="Submitted payment proof" />
            <a href={uploadUrl(previewProof)} target="_blank" rel="noreferrer" className="billing-doc-link">
              Open full size <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {creditVendor && (
        <div className="modal-overlay" onClick={closeCreditEditor}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={`Edit credit limit for ${creditVendor.vendorName}`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Credit limit — {creditVendor.vendorName}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeCreditEditor} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <p className="modal-desc">
              Outstanding delivery charges past this amount block new orders.
            </p>
            <div className="form-grid">
              <FormField
                label="Credit limit (NPR)"
                required
                type="decimal"
                value={creditValue}
                onChange={(v) => { setCreditValue(v); setCreditError(''); }}
                placeholder="50000"
                hint="Only this vendor changes."
              />
            </div>
            {creditError && <p role="alert" className="error-text">{creditError}</p>}
            <div className="modal-footer">
              <Button variant="secondary" onClick={closeCreditEditor} disabled={creditSaving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleSaveCredit()} disabled={creditSaving}>
                {creditSaving ? 'Saving…' : 'Save limit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
