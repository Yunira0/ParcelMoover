import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, FileText, QrCode, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Table from '../../components/Table';
import Button from '../../components/Button';
import FileField from '../../components/FileField';
import Pagination from '../../components/Pagination';
import { getCurrentUserLocationId, getCurrentUserRoles, isAdminSide, isBranchWorkspaceUser } from '../../utils/auth';
import { formatCurrency } from '../../utils/format';
import { toBsDate } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import {
  getBillingSettings, paymentQrUrl, updateBillingSettings, uploadPaymentQr, type BillingSettings,
} from '../../services/billing.service';
import {
  getBranchBillingStatus, listBranchBalances, listBranchPayments, reviewBranchPayment,
  submitBranchPayment, type BranchBillingStatus, type BranchPayment,
} from '../../services/branchBilling.service';
import { getBranchSettlements, type BranchSettlement } from '../../services/branchTracking.service';
import '../vendor/VendorFinance.css';
import '../vendor/VendorBilling.css';
import '../BillingManagement.css';
import '../../components/Modal.css';

type Tab = 'pay' | 'queue' | 'statements' | 'branches' | 'settings';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');
const uploadUrl = (path: string) => `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;
const isImagePath = (path: string) => /\.(jpe?g|png|webp|gif)$/i.test(path);
const PAYMENT_STATUS_LABEL: Record<BranchPayment['status'], string> = {
  pending: 'Awaiting verification', verified: 'Verified', rejected: 'Rejected',
};

const BranchBilling: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const isBranchWorkspace = isBranchWorkspaceUser();
  // Master workspace = head-office admin side, not merely "not a branch user":
  // a non-admin who slips past routing must not land on the office queue.
  const isMasterWorkspace = isAdminSide() && !isBranchWorkspace;
  const hasAssignedBranch = Boolean(getCurrentUserLocationId());
  const requestedTab = searchParams.get('tab');
  const initialTab: Tab = !isMasterWorkspace && requestedTab === 'statements'
    ? 'statements'
    : isMasterWorkspace ? 'queue' : 'pay';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [error, setError] = useState('');

  const [payments, setPayments] = useState<BranchPayment[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsTotalPages, setPaymentsTotalPages] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(50);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [previewProof, setPreviewProof] = useState<string | null>(null);

  const [branchStatus, setBranchStatus] = useState<BranchBillingStatus | null>(null);
  const [payAmount, setPayAmount] = useState<string | null>(null);
  const [payReference, setPayReference] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payProof, setPayProof] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payMessage, setPayMessage] = useState('');
  const [qrLoadFailed, setQrLoadFailed] = useState(false);

  const [balances, setBalances] = useState<BranchBillingStatus[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [branchWarn, setBranchWarn] = useState('');
  const [branchBlock, setBranchBlock] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrMessage, setQrMessage] = useState('');
  const [qrError, setQrError] = useState('');

  const [pendingSettlements, setPendingSettlements] = useState<BranchSettlement[]>([]);
  const [selectedSettlement, setSelectedSettlement] = useState<BranchSettlement | null>(null);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptProof, setReceiptProof] = useState<File | null>(null);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState('');

  const tabs = useMemo<Array<{ value: Tab; label: string; count?: number }>>(
    () => isSuperAdmin ? [
      { value: 'queue', label: 'Payment verification', count: paymentsTotal },
      { value: 'statements', label: 'Statements' },
      { value: 'branches', label: 'Branch balances' },
      { value: 'settings', label: 'Thresholds & QR' },
    ] : isMasterWorkspace ? [
      { value: 'queue', label: 'Payment verification', count: paymentsTotal },
      { value: 'statements', label: 'Statements' },
    ] : [
      { value: 'pay', label: 'Add money' },
      { value: 'statements', label: 'Settlements' },
      { value: 'queue', label: 'Payment history' },
    ], [isMasterWorkspace, isSuperAdmin, paymentsTotal],
  );

  const loadPayments = useCallback(async () => {
    if (isBranchWorkspace && !hasAssignedBranch) {
      setPaymentsLoading(false);
      return;
    }
    setPaymentsLoading(true);
    try {
      const result = await listBranchPayments({
        ...(isMasterWorkspace ? { status: 'pending' as const } : {}), page: paymentsPage, pageSize: paymentsPageSize,
      });
      setPayments(result.data);
      setPaymentsTotal(result.meta.total);
      setPaymentsTotalPages(result.meta.totalPages);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load branch payments.'));
    } finally { setPaymentsLoading(false); }
  }, [hasAssignedBranch, isBranchWorkspace, isMasterWorkspace, paymentsPage, paymentsPageSize]);

  const loadBranchStatus = useCallback(async () => {
    if (isMasterWorkspace || !hasAssignedBranch) return;
    try { setBranchStatus(await getBranchBillingStatus()); setError(''); }
    catch (err) { setError(apiErrorMessage(err, 'Failed to load your branch balance.')); }
  }, [hasAssignedBranch, isMasterWorkspace]);

  const loadBalances = useCallback(async () => {
    if (!isSuperAdmin) return;
    setBalancesLoading(true);
    try { setBalances(await listBranchBalances()); setError(''); }
    catch (err) { setError(apiErrorMessage(err, 'Failed to load branch balances.')); }
    finally { setBalancesLoading(false); }
  }, [isSuperAdmin]);

  const loadPendingSettlements = useCallback(async () => {
    if (isMasterWorkspace) return;
    try {
      const [pending, partial] = await Promise.all([
        getBranchSettlements({ status: 'pending', scope: 'outgoing', page: 1, pageSize: 100 }),
        getBranchSettlements({ status: 'partially_paid', scope: 'outgoing', page: 1, pageSize: 100 }),
      ]);
      setPendingSettlements([...pending.data, ...partial.data]);
    } catch (err) { setError(apiErrorMessage(err, 'Failed to load pending settlements.')); }
  }, [isMasterWorkspace]);

  const loadSettings = useCallback(async () => {
    try {
      const next = await getBillingSettings();
      setSettings(next);
      setBranchWarn(String(next.branchWarnThreshold));
      setBranchBlock(String(next.branchBlockThreshold));
    } catch (err) { setError(apiErrorMessage(err, 'Failed to load billing settings.')); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading state
  useEffect(() => { void loadPayments(); void loadSettings(); void loadBranchStatus(); }, [loadBranchStatus, loadPayments, loadSettings]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- tab activation lazily loads the report
  useEffect(() => { if (activeTab === 'branches' && balances.length === 0) void loadBalances(); }, [activeTab, balances.length, loadBalances]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- tab activation lazily loads branch statements
  useEffect(() => { if (activeTab === 'statements') void loadPendingSettlements(); }, [activeTab, loadPendingSettlements]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- return to the last non-empty page after queue review
  useEffect(() => { if (!paymentsLoading && payments.length === 0 && paymentsPage > 1) setPaymentsPage(1); }, [paymentsLoading, payments.length, paymentsPage]);

  const review = async (payment: BranchPayment, decision: 'verified' | 'rejected') => {
    setReviewing(payment.id); setError('');
    try {
      await reviewBranchPayment(payment.id, decision, remarks[payment.id]);
      await loadPayments();
      if (balances.length) await loadBalances();
    } catch (err) { setError(apiErrorMessage(err, 'Failed to review branch payment.')); }
    finally { setReviewing(null); }
  };

  const submitMoney = async (event: React.FormEvent) => {
    event.preventDefault();
    const suggested = branchStatus && branchStatus.balance < 0 ? Math.abs(branchStatus.balance).toFixed(2) : '';
    const amount = Number(payAmount ?? suggested);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount you paid.'); return; }
    setPaySaving(true); setError(''); setPayMessage('');
    try {
      await submitBranchPayment({ amount, reference: payReference, note: payNote, proof: payProof });
      setPayMessage('Payment submitted. It will be added after the head branch verifies it.');
      setPayAmount(null); setPayReference(''); setPayNote(''); setPayProof(null); setPaymentsPage(1);
      await Promise.all([loadPayments(), loadBranchStatus()]);
    } catch (err) { setError(apiErrorMessage(err, 'Failed to submit branch payment.')); }
    finally { setPaySaving(false); }
  };

  const saveThresholds = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingSettings(true); setSettingsMessage(''); setSettingsError('');
    try {
      setSettings(await updateBillingSettings({ branchWarnThreshold: Number(branchWarn), branchBlockThreshold: Number(branchBlock) }));
      setSettingsMessage('Branch thresholds saved.');
      if (balances.length) await loadBalances();
    } catch (err) { setSettingsError(apiErrorMessage(err, 'Failed to save branch thresholds.')); }
    finally { setSavingSettings(false); }
  };

  const replaceQr = async () => {
    if (!qrFile) return;
    setQrUploading(true); setQrError(''); setQrMessage('');
    try { setSettings(await uploadPaymentQr(qrFile)); setQrFile(null); setQrMessage('QR updated — branches will see it immediately.'); }
    catch (err) { setQrError(apiErrorMessage(err, 'Failed to upload QR.')); }
    finally { setQrUploading(false); }
  };

  const submitReceipt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSettlement) return;
    const amount = Number(receiptAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the receipt amount.'); return; }
    setReceiptSaving(true); setError(''); setReceiptMessage('');
    try {
      await submitBranchPayment({ settlementId: selectedSettlement.id, amount, reference: receiptReference, note: receiptNote, proof: receiptProof });
      setReceiptMessage(`Payment submitted for ${selectedSettlement.statementNo}. It will clear after the head branch verifies it.`);
      setSelectedSettlement(null); setReceiptAmount(''); setReceiptReference(''); setReceiptNote(''); setReceiptProof(null); setPaymentsPage(1);
      await Promise.all([loadPayments(), loadPendingSettlements()]);
    } catch (err) { setError(apiErrorMessage(err, 'Failed to submit payment receipt.')); }
    finally { setReceiptSaving(false); }
  };

  const proofCell = (payment: BranchPayment) => payment.proofPath ? (isImagePath(payment.proofPath) ? (
    <button type="button" className="billing-doc-link billing-doc-preview-btn" onClick={() => setPreviewProof(payment.proofPath)}><FileText size={14} /> View</button>
  ) : (
    <a href={uploadUrl(payment.proofPath)} target="_blank" rel="noreferrer" className="billing-doc-link"><FileText size={14} /> View <ExternalLink size={12} /></a>
  )) : '—';

  const officePaymentColumns = [
    { header: 'DATE', accessor: (payment: BranchPayment) => toBsDate(payment.createdAt) || '—', width: '110px' },
    { header: 'BRANCH', accessor: (payment: BranchPayment) => payment.branchName, width: '190px' },
    { header: 'AMOUNT', accessor: (payment: BranchPayment) => formatCurrency(payment.amount), width: '130px' },
    { header: 'REFERENCE', accessor: (payment: BranchPayment) => payment.reference || '—', width: '180px' },
    { header: 'PROOF', accessor: proofCell, width: '110px' },
    { header: 'NOTE', accessor: (payment: BranchPayment) => payment.note || '—', width: '180px' },
    { header: 'DECISION', width: '300px', accessor: (payment: BranchPayment) => <div className="billing-review-cell"><input placeholder="Remark (required to reject)" value={remarks[payment.id] ?? ''} onChange={(event) => setRemarks((old) => ({ ...old, [payment.id]: event.target.value }))} disabled={reviewing === payment.id} /><div className="billing-review-actions"><Button variant="primary" onClick={() => void review(payment, 'verified')} disabled={reviewing === payment.id}>Verify</Button><Button variant="secondary" onClick={() => void review(payment, 'rejected')} disabled={reviewing === payment.id}>Reject</Button></div></div> },
  ];
  const historyColumns = [
    { header: 'DATE', accessor: (payment: BranchPayment) => toBsDate(payment.createdAt) || '—', width: '110px' },
    { header: 'AMOUNT', accessor: (payment: BranchPayment) => formatCurrency(payment.amount), width: '130px' },
    { header: 'SETTLEMENT', accessor: (payment: BranchPayment) => payment.statementNo || 'General credit', width: '180px' },
    { header: 'REFERENCE', accessor: (payment: BranchPayment) => payment.reference || '—', width: '180px' },
    { header: 'PROOF', accessor: proofCell, width: '110px' },
    { header: 'STATUS', accessor: (payment: BranchPayment) => <span className={`billing-pill billing-pill-${payment.status}`}>{payment.status === 'verified' && <CheckCircle2 size={12} />}{payment.status === 'pending' && <Clock size={12} />}{PAYMENT_STATUS_LABEL[payment.status]}</span>, width: '180px' },
    { header: 'REMARK', accessor: (payment: BranchPayment) => payment.reviewRemark || '—', width: '190px' },
  ];
  const balanceColumns = [
    { header: 'BRANCH', accessor: (branch: BranchBillingStatus) => branch.branchName, width: '220px' },
    { header: 'UNSETTLED COD', accessor: (branch: BranchBillingStatus) => formatCurrency(branch.unsettledCod), width: '150px' },
    { header: 'VERIFIED CREDIT', accessor: (branch: BranchBillingStatus) => formatCurrency(branch.paymentsReceived), width: '160px' },
    { header: 'OUTSTANDING', accessor: (branch: BranchBillingStatus) => <span className={branch.balance < 0 ? 'billing-debit' : ''}>{formatCurrency(Math.max(0, -branch.balance))}</span>, width: '150px' },
    { header: 'STATE', accessor: (branch: BranchBillingStatus) => <span className={`billing-pill billing-pill-${branch.state === 'warned' ? 'pending' : branch.state}`}>{branch.state === 'blocked' ? 'Transit blocked' : branch.state === 'warned' ? 'Warning' : 'Clear'}</span>, width: '140px' },
  ];
  const balanceRows = balances.map((branch) => ({ ...branch, id: branch.branchId }));
  const pendingRows = pendingSettlements.map((settlement) => ({ ...settlement, id: settlement.id }));
  const pendingColumns = [
    { header: 'STATEMENT', accessor: (settlement: BranchSettlement) => settlement.statementNo, width: '190px' },
    { header: 'MASTER BRANCH', accessor: (settlement: BranchSettlement) => settlement.toBranch, width: '200px' },
    { header: 'ORDERS', accessor: (settlement: BranchSettlement) => settlement.orderCount, width: '90px' },
    { header: 'OUTSTANDING', accessor: (settlement: BranchSettlement) => formatCurrency(settlement.remainingAmount), width: '150px' },
    { header: 'ACTION', accessor: (settlement: BranchSettlement) => <Button variant="primary" onClick={() => { setSelectedSettlement(settlement); setReceiptAmount(String(settlement.remainingAmount)); setReceiptMessage(''); }}>Add payment</Button>, width: '160px' },
  ];
  const owed = branchStatus ? Math.max(0, -branchStatus.balance) : 0;
  const suggestedAmount = branchStatus && branchStatus.state !== 'ok'
    ? (branchStatus.state === 'blocked' ? branchStatus.amountToClearBlock : owed).toFixed(2) : '';
  const amountValue = payAmount ?? suggestedAmount;

  return <div className="vendor-finance-page">
    <PageHeader title={isMasterWorkspace ? 'Branch Payments' : 'Pay Master Branch'} subtitle={isMasterWorkspace ? 'Verify COD remittances submitted by paying branches.' : 'Pay the master branch, attach the receipt, and track verification.'} />
    <SegmentedTabs ariaLabel="Branch billing sections" value={activeTab} onChange={setActiveTab} options={tabs} />
    {error && <p className="vendor-finance-error">{error}</p>}

    {isBranchWorkspace && !hasAssignedBranch && <div className="billing-banner billing-banner-warned"><AlertTriangle size={18} /><div><strong>No branch assigned</strong><p>Ask the master branch to assign this admin account to a branch before adding money.</p></div></div>}

    {activeTab === 'pay' && isBranchWorkspace && hasAssignedBranch && <>
      {branchStatus?.state !== 'ok' && branchStatus && <div className={`billing-banner billing-banner-${branchStatus.state}`}><AlertTriangle size={18} /><div><strong>{branchStatus.state === 'blocked' ? 'Incoming transit is paused' : 'Branch COD is due'}</strong><p>{branchStatus.state === 'blocked' ? `${formatCurrency(owed)} is outstanding. Add at least ${formatCurrency(branchStatus.amountToClearBlock)} to resume incoming transit.` : `${formatCurrency(owed)} is outstanding and awaiting deposit.`}</p></div></div>}
      <div className="billing-grid">
        <section className="billing-card"><h3>Branch balance</h3>{branchStatus ? <div className="billing-breakdown"><div><span>Unsettled COD</span><span>{formatCurrency(branchStatus.unsettledCod)}</span></div><div><span>Verified deposits</span><span>{formatCurrency(branchStatus.paymentsReceived)}</span></div><div className="billing-breakdown-total"><span>Amount outstanding</span><span className={owed > 0 ? 'billing-debit' : ''}>{formatCurrency(owed)}</span></div></div> : <p className="billing-hint">Loading branch balance…</p>}{branchStatus && branchStatus.pendingPaymentAmount > 0 && <p className="billing-hint"><Clock size={14} /> {formatCurrency(branchStatus.pendingPaymentAmount)} submitted and awaiting head branch verification.</p>}</section>
        <section className="billing-card"><h3>Add money</h3>
          <div className="billing-step"><h4 className="billing-step-title">1. Scan and pay</h4>{settings?.paymentQrPath && !qrLoadFailed ? <img className="billing-qr" src={paymentQrUrl(settings.paymentQrPath)} alt="Scan to pay the head branch" onError={() => setQrLoadFailed(true)} /> : <p className="billing-hint"><QrCode size={14} />{settings?.paymentQrPath ? "The payment QR couldn't be loaded. Refresh and try again." : 'No payment QR has been configured. Contact the head branch for payment details.'}</p>}{settings?.paymentNote && <p className="billing-hint">{settings.paymentNote}</p>}</div>
          <div className="billing-step"><h4 className="billing-step-title">2. Add your payment</h4><form className="billing-form" onSubmit={submitMoney}>
            <label>Amount paid<div className="billing-amount-field"><span className="billing-amount-prefix">Rs.</span><input type="number" min="0" step="0.01" value={amountValue} onChange={(event) => setPayAmount(event.target.value)} placeholder="0.00" disabled={paySaving} /></div>{suggestedAmount && <span className="billing-field-hint">Suggested: {formatCurrency(Number(suggestedAmount))}</span>}</label>
            <label>Transaction reference<input type="text" value={payReference} onChange={(event) => setPayReference(event.target.value)} placeholder="From your payment app" disabled={paySaving} /></label>
            <label>Note (optional)<input type="text" value={payNote} onChange={(event) => setPayNote(event.target.value)} disabled={paySaving} /></label>
            <FileField label="Payment screenshot (optional)" hint="JPG, PNG, WebP or PDF · max 5 MB" file={payProof} onChange={setPayProof} />
            {payMessage && <p className="billing-success"><CheckCircle2 size={14} /> {payMessage}</p>}
            <Button type="submit" variant="primary" disabled={paySaving}>{paySaving ? 'Submitting…' : 'Add money'}</Button><p className="billing-hint">The amount is credited after the head branch verifies your payment.</p>
          </form></div>
        </section>
      </div>
    </>}

    {activeTab === 'queue' && <><Table columns={isMasterWorkspace ? officePaymentColumns : historyColumns} data={payments} loading={paymentsLoading} loadingMessage="Loading branch payments…" emptyMessage={isMasterWorkspace ? 'No payments awaiting verification.' : 'No branch payments added yet.'} minWidth={isMasterWorkspace ? '1290px' : '1080px'} /><Pagination ariaLabel={isMasterWorkspace ? 'Branch payment verification pagination' : 'Branch payment history pagination'} page={paymentsPage} totalPages={paymentsTotalPages} onPageChange={setPaymentsPage} pageSize={paymentsPageSize} pageSizeLabel="payments" onPageSizeChange={(size) => { setPaymentsPageSize(size); setPaymentsPage(1); }} summary={`${paymentsTotal} payment${paymentsTotal === 1 ? '' : 's'}`} /></>}

    {activeTab === 'statements' && (isMasterWorkspace ? <p className="billing-hint">Open Branch COD from the sidebar to create and review COD due to the master branch.</p> : <>
      <section className="billing-card"><h3>COD due to the master branch</h3><p className="billing-hint">Pay a statement and attach the receipt or screenshot. It becomes settled after the master branch verifies it.</p><Table selectable={false} columns={pendingColumns} data={pendingRows} emptyMessage="No COD statements are awaiting payment." minWidth="900px" /></section>
      {selectedSettlement && <section className="billing-card"><h3>Add payment · {selectedSettlement.statementNo}</h3><form className="billing-form" onSubmit={submitReceipt}><label>Amount paid<div className="billing-amount-field"><span className="billing-amount-prefix">Rs.</span><input type="number" min="0" max={selectedSettlement.remainingAmount} step="0.01" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} disabled={receiptSaving} /></div></label><label>Transaction reference<input type="text" value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} disabled={receiptSaving} /></label><label>Note (optional)<input type="text" value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} disabled={receiptSaving} /></label><FileField label="Paid receipt / screenshot" hint="JPG, PNG, WebP or PDF · max 5 MB" file={receiptProof} onChange={setReceiptProof} /><div className="billing-review-actions"><Button type="button" variant="secondary" onClick={() => setSelectedSettlement(null)} disabled={receiptSaving}>Cancel</Button><Button type="submit" variant="primary" disabled={receiptSaving}>{receiptSaving ? 'Submitting…' : 'Submit payment'}</Button></div></form></section>}
      {receiptMessage && <p className="billing-success"><CheckCircle2 size={14} /> {receiptMessage}</p>}
    </>)}

    {activeTab === 'branches' && isSuperAdmin && <><p className="billing-hint">A branch at its block threshold cannot receive new transit until verified credit clears the hold.</p><Table columns={balanceColumns} data={balanceRows} loading={balancesLoading} loadingMessage="Calculating branch balances…" emptyMessage="No active branches found." minWidth="950px" /></>}

    {activeTab === 'settings' && isSuperAdmin && <div className="billing-grid"><section className="billing-card"><h3>Branch transit thresholds</h3><p className="billing-hint">Both values are negative balances. A branch is warned at the first threshold and cannot receive transit at the block threshold.</p><form className="billing-form" onSubmit={saveThresholds}><label>Warn threshold<input type="number" step="0.01" value={branchWarn} onChange={(event) => setBranchWarn(event.target.value)} disabled={savingSettings} /></label><label>Transit block threshold<input type="number" step="0.01" value={branchBlock} onChange={(event) => setBranchBlock(event.target.value)} disabled={savingSettings} /></label>{settingsError && <p className="vendor-finance-error">{settingsError}</p>}{settingsMessage && <p className="billing-success"><CheckCircle2 size={14} /> {settingsMessage}</p>}<Button type="submit" variant="primary" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save thresholds'}</Button></form></section><section className="billing-card"><h3>Branch payment QR</h3><p className="billing-hint">Shown to branch staff before they add money.</p>{settings?.paymentQrPath ? <img className="billing-qr" src={paymentQrUrl(settings.paymentQrPath)} alt="Current payment QR" /> : <p className="billing-hint">No QR uploaded yet.</p>}<FileField label={settings?.paymentQrPath ? 'Replace with a new QR' : 'Upload a QR'} hint="JPG, PNG, or WebP · max 5 MB" file={qrFile} onChange={(file) => { setQrFile(file); setQrError(''); setQrMessage(''); }} />{qrError && <p className="vendor-finance-error">{qrError}</p>}{qrMessage && <p className="billing-success"><CheckCircle2 size={14} /> {qrMessage}</p>}{qrFile && <div className="billing-review-actions"><Button variant="secondary" onClick={() => setQrFile(null)} disabled={qrUploading}>Cancel</Button><Button variant="primary" onClick={() => void replaceQr()} disabled={qrUploading}>{qrUploading ? 'Uploading…' : 'Replace QR'}</Button></div>}</section></div>}

    {previewProof && <div className="modal-overlay" onClick={() => setPreviewProof(null)}><div className="billing-proof-modal" onClick={(event) => event.stopPropagation()}><div className="billing-proof-modal-header"><span>Branch payment proof</span><button type="button" className="billing-proof-modal-close" onClick={() => setPreviewProof(null)} aria-label="Close preview"><X size={18} /></button></div><img src={uploadUrl(previewProof)} alt="Submitted branch payment proof" /><a href={uploadUrl(previewProof)} target="_blank" rel="noreferrer" className="billing-doc-link">Open full size <ExternalLink size={12} /></a></div></div>}
  </div>;
};

export default BranchBilling;
