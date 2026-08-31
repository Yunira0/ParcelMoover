import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Printer, Download, CreditCard, FileText, Paperclip, Pencil, Plus, Trash2, Undo2, Ban } from 'lucide-react';
import Button from '../components/Button';
import StatusChip from '../components/StatusChip';
import SegmentedTabs from '../components/SegmentedTabs';
import EditSettlementModal from '../components/EditSettlementModal';
import RevertSettlementModal from '../components/RevertSettlementModal';
import AttachSettlementDocumentsCard from '../components/AttachSettlementDocumentsCard';
import ConfirmBanner from '../components/ConfirmBanner';
import {
  getSettlementDetail,
  deleteSettlementDocument,
  type SettlementDetail,
  type SettlementDocument,
} from '../services/finance.service';
import { hasAnyRole, hasAdminPermission } from '../utils/auth';
import {
  hasSettlementPayments,
  isSettlementPayable,
  settlementStatusLabel,
  settlementStatusTone,
} from '../utils/settlementStatus';
import { toBsDate, toBsDateTime } from '../utils/nepaliDate';
import { downloadExcel } from '../utils/excel';
import './vendor/VendorFinance.css';
import './SettlementDetailPage.css';

const money = (value: number) => `Rs. ${value.toLocaleString()}`;
const hubNameOnly = (value: string) => ((value || '').split(' - ')[0] ?? '').replace(/\s*Branch\s*$/i, '').trim();

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

type DetailTab = 'billing' | 'receipt' | 'invoice';

// Payment documents go through the settlement's own endpoint rather than the
// /uploads mount: that mount is admin-only, so a vendor opening the receipt on
// their own statement would get a 403. This route re-checks access to the
// statement itself, so the payee and their sales rep can read their paperwork.
const API_ROOT = import.meta.env.VITE_API_URL || '/api';
const documentUrl = (settlementId: string, documentId: string) =>
  `${API_ROOT}/finance/settlements/${settlementId}/documents/${documentId}`;

// What a single uploaded file looks like, plus the actions that only make sense
// on a statement holding several: swap this one out, or drop it entirely.
const DocumentCard: React.FC<{
  label: string;
  only: 'receipt' | 'taxInvoice';
  settlementId: string;
  document: SettlementDocument;
  /** Which instalment this file proves, for the caption. Undefined when it covers the statement as a whole. */
  paymentCaption?: string;
  canManage: boolean;
  onChanged: () => void;
}> = ({ label, only, settlementId, document, paymentCaption, canManage, onChanged }) => {
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const href = documentUrl(settlementId, document.id);

  if (replacing) {
    return (
      <AttachSettlementDocumentsCard
        settlementId={settlementId}
        only={only}
        replaceDocumentId={document.id}
        title={`Replace ${label.toLowerCase()}`}
        caption={`Upload a new file to replace this ${label.toLowerCase()}. To keep this one and add another picture, cancel and use "Add another" instead.`}
        submitLabel="Save"
        dismissLabel="Cancel"
        onDone={() => {
          setReplacing(false);
          onChanged();
        }}
        onDismiss={() => setReplacing(false)}
      />
    );
  }

  const handleRemove = async () => {
    setRemoving(true);
    setError('');
    try {
      await deleteSettlementDocument(settlementId, document.id);
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to remove this file');
      setRemoving(false);
    }
  };

  return (
    <div className="settlement-doc-view">
      {paymentCaption && <span className="settlement-doc-caption">{paymentCaption}</span>}
      {/* A PDF previews inline rather than sitting behind a placeholder tile —
          a tax invoice is usually the thing being checked, so making it
          readable without leaving the page is the point. Images stay a link to
          the full-size file. */}
      {document.isPdf ? (
        <div className="settlement-doc-frame settlement-doc-pdf-wrap">
          <iframe className="settlement-doc-pdf-frame" src={href} title={label} />
        </div>
      ) : (
        <a className="settlement-doc-frame" href={href} target="_blank" rel="noreferrer">
          <img src={href} alt={label} loading="lazy" />
        </a>
      )}
      {document.isPdf && (
        <a className="settlement-doc-open-link" href={href} target="_blank" rel="noreferrer">
          <FileText size={14} />
          Open in new tab
        </a>
      )}
      {canManage && (
        <div className="settlement-doc-actions">
          <button type="button" className="settlement-attach-proof-btn" onClick={() => setReplacing(true)}>
            <Paperclip size={14} />
            Replace {label.toLowerCase()}
          </button>
          <button
            type="button"
            className="settlement-attach-proof-btn settlement-attach-proof-btn--danger"
            onClick={handleRemove}
            disabled={removing}
          >
            <Trash2 size={14} />
            {removing ? 'Removing...' : 'Remove'}
          </button>
        </div>
      )}
      {error && <p className="vendor-finance-error">{error}</p>}
    </div>
  );
};

// One kind of document's whole tab. A statement can carry several of them now —
// a receipt per instalment when a payout is paid in parts, plus extra pictures
// of the same transfer — so this is a gallery with an "Add another" affordance
// rather than a single slot that can only be overwritten.
const DocumentTabPanel: React.FC<{
  label: string;
  only: 'receipt' | 'taxInvoice';
  settlementId: string;
  documents: SettlementDocument[];
  /** Payment id -> a short "1st payment · Rs. 1,000" style caption. */
  paymentCaptions: Map<string, string>;
  canAttach: boolean;
  onChanged: () => void;
}> = ({ label, only, settlementId, documents, paymentCaptions, canAttach, onChanged }) => {
  const [attaching, setAttaching] = useState(false);

  if (attaching) {
    return (
      <AttachSettlementDocumentsCard
        settlementId={settlementId}
        only={only}
        title={documents.length > 0 ? `Add another ${label.toLowerCase()}` : `Attach ${label.toLowerCase()}`}
        caption={`Add the ${label.toLowerCase()} for this statement. You can pick more than one file · JPG, PNG, WebP or PDF, max 5 MB each.`}
        submitLabel="Save"
        dismissLabel="Cancel"
        onDone={() => {
          setAttaching(false);
          onChanged();
        }}
        onDismiss={() => setAttaching(false)}
      />
    );
  }

  if (documents.length === 0) {
    return (
      <div className="settlement-doc-empty">
        <FileText size={22} className="settlement-doc-empty-icon" />
        <p>No {label.toLowerCase()} attached yet.</p>
        {canAttach && (
          <button type="button" className="settlement-attach-proof-btn" onClick={() => setAttaching(true)}>
            <Paperclip size={14} />
            Attach {label.toLowerCase()}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="settlement-doc-gallery">
      {documents.map((doc) => {
        const caption = doc.paymentId ? paymentCaptions.get(doc.paymentId) : undefined;
        return (
          <DocumentCard
            key={doc.id}
            label={label}
            only={only}
            settlementId={settlementId}
            document={doc}
            {...(caption ? { paymentCaption: caption } : {})}
            canManage={canAttach}
            onChanged={onChanged}
          />
        );
      })}
      {canAttach && (
        <button
          type="button"
          className="settlement-attach-proof-btn settlement-doc-add"
          onClick={() => setAttaching(true)}
        >
          <Plus size={14} />
          Add another {label.toLowerCase()}
        </button>
      )}
    </div>
  );
};

function buildStatementHtml(detail: SettlementDetail): string {
  // On a vendor statement the vendor is already the payee in BILL TO, so the
  // per-row column would repeat the same name on every line.
  const showVendor = detail.payeeType === 'rider';

  const rows = detail.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>#${item.orderNumber}</td>
          <td>
            <div style="font-family:monospace">${item.trackingId}</div>
            ${item.deliveredAt ? `<div class="sub">${toBsDateTime(item.deliveredAt)}</div>` : ''}
            ${item.orderType ? `<div class="sub">${item.orderType}</div>` : ''}
          </td>
          ${
            showVendor
              ? `<td>${item.vendorName ?? '-'}${
                  item.vendorPhone ? `<div class="sub">${item.vendorPhone}</div>` : ''
                }</td>`
              : ''
          }
          <td>${item.receiverName}${item.receiverAddress ? `<div class="sub">${item.receiverAddress}</div>` : ''}</td>
          <td>${item.destination ? hubNameOnly(item.destination) : '-'}</td>
          <td>${item.receiverPhone}</td>
          <td class="r">${item.weightKg === null ? '-' : item.weightKg.toFixed(2)}</td>
          <td class="r">${money(item.codAmount)}</td>
          <td class="r">${money(item.collectedAmount)}</td>
          <td class="r">${money(item.deliveryCharge)}</td>
          <td class="r">${money(item.settledAmount)}</td>
        </tr>`,
    )
    .join('');

  const totals = detail.items.reduce(
    (acc, item) => {
      acc.cod += item.codAmount;
      acc.collected += item.collectedAmount;
      acc.deliveryCharge += item.deliveryCharge;
      return acc;
    },
    { cod: 0, collected: 0, deliveryCharge: 0 },
  );

  return `<!doctype html><html><head><meta charset="utf-8"><title>${detail.statementId}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:32px;max-width:960px;margin:0 auto}
      h1{font-size:22px;margin:0 0 4px}
      .muted{color:#6b7280}
      .sub{color:#6b7280;font-size:11px}
      .head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:24px;margin-bottom:24px}
      .meta div{display:flex;justify-content:space-between;gap:24px;font-size:13px;min-width:240px}
      table{width:100%;border-collapse:collapse;margin-bottom:24px}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px}
      th{text-transform:uppercase;color:#6b7280;font-size:11px}
      .r{text-align:right}
      .totals{margin-left:auto;width:280px}
      .totals div{display:flex;justify-content:space-between;font-size:13px;padding:2px 0}
      .payable{font-weight:700;border-top:1px solid #e5e7eb;padding-top:6px;margin-top:6px}
    </style></head><body>
    <div class="head">
      <div>
        <div class="muted">BILL TO</div>
        <h1>${detail.payeeName}</h1>
        <div>${detail.payeePhone}</div>
        ${detail.payeeEmail ? `<div>${detail.payeeEmail}</div>` : ''}
        ${detail.payeeAddress ? `<div>${detail.payeeAddress}</div>` : ''}
        ${detail.payeePan ? `<div>PAN: ${detail.payeePan}</div>` : ''}
      </div>
      <div class="meta">
        <div><span class="muted">Statement</span><span>${detail.statementId}</span></div>
        <div><span class="muted">Statement date</span><span>${detail.transferDate ? toBsDate(detail.transferDate) : '-'}</span></div>
        <div><span class="muted">Payment status</span><span>${settlementStatusLabel(detail.status)}</span></div>
        ${
          detail.status === 'partially_paid'
            ? `<div><span class="muted">Paid so far</span><span>${money(detail.paidAmount)}</span></div>
        <div><span class="muted">Still outstanding</span><span>${money(detail.remainingAmount)}</span></div>`
            : ''
        }
        ${detail.remark ? `<div><span class="muted">Remark</span><span>${detail.remark}</span></div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr>
        <th>SN</th><th>Order ID</th><th>Transaction ID</th>${showVendor ? '<th>Vendor</th>' : ''}<th>Receiver</th><th>Destination</th><th>Number</th>
        <th class="r">Weight</th><th class="r">COD</th>
        <th class="r">Collected COD</th><th class="r">Delivery Charges</th>
        <th class="r">Net Payable</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Total COD</span><span>${money(totals.cod)}</span></div>
      <div><span>Collected COD</span><span>${money(totals.collected)}</span></div>
      <div><span>Delivery Charges</span><span>${money(totals.deliveryCharge)}</span></div>
      <div class="payable"><span>${detail.payeeType === 'rider' ? 'Receivable Amount' : 'Payable Amount'}</span><span>${money(detail.payableAmount)}</span></div>
    </div>
  </body></html>`;
}

type BannerMessage = { title: string; meta?: string };

const SettlementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showEdit, setShowEdit] = useState(false);
  const [showRevert, setShowRevert] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [tab, setTab] = useState<DetailTab>('billing');
  // Acknowledges a money-moving action that just completed - either handed in
  // via router state (a redirect from the pay flow) or set locally once a
  // revert/cancel on this same page succeeds. Cleared from history state
  // immediately so a refresh or back-navigation doesn't replay it.
  const [banner, setBanner] = useState<BannerMessage | null>(
    (location.state as { confirmBanner?: BannerMessage } | null)?.confirmBanner ?? null,
  );

  useEffect(() => {
    if ((location.state as { confirmBanner?: BannerMessage } | null)?.confirmBanner) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // Only needs to run once, on the redirect that actually carried the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  const canPay = hasAnyRole(['super_admin', 'admin']);
  // Correcting a mistake — gated by the delegable EDIT_SETTLEMENTS permission,
  // same pattern as MANAGE_USERS/SETTINGS_ACCESS. Also covers reverting a
  // settled statement back to pending, since it's the same "fix a mistake"
  // privilege applied after payment instead of before it.
  const canEdit = hasAnyRole(['super_admin']) || hasAdminPermission('EDIT_SETTLEMENTS');
  // See buildStatementHtml - only rider statements mix parcels from several
  // vendors, so only there does a per-row vendor column carry information.
  const showVendor = detail?.payeeType === 'rider';
  // Riders are paid cash-in-hand with no paperwork trail - only vendor
  // payouts get the receipt/invoice tabs. A part-paid statement gets them too:
  // the money that has moved deserves its proof filed straight away.
  const showDocumentTabs = Boolean(
    detail && hasSettlementPayments(detail.status) && detail.payeeType === 'vendor',
  );

  const receipts = detail?.documents.filter((doc) => doc.kind === 'receipt') ?? [];
  const taxInvoices = detail?.documents.filter((doc) => doc.kind === 'tax_invoice') ?? [];

  // Which instalment a file belongs to, phrased for a caption above it. Only
  // worth showing once there's more than one payment to tell apart.
  const paymentCaptions = new Map<string, string>();
  if (detail && detail.paymentRecords.length > 1) {
    detail.paymentRecords.forEach((payment, index) => {
      paymentCaptions.set(payment.id, `Payment ${index + 1} · ${money(payment.amount)} · ${payment.method}`);
    });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getSettlementDetail(id)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load settlement detail');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const totals = detail
    ? detail.items.reduce(
        (acc, item) => {
          acc.cod += item.codAmount;
          acc.collected += item.collectedAmount;
          acc.deliveryCharge += item.deliveryCharge;
          return acc;
        },
        { cod: 0, collected: 0, deliveryCharge: 0 },
      )
    : { cod: 0, collected: 0, deliveryCharge: 0 };

  const handlePrint = () => {
    if (!detail) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildStatementHtml(detail));
    win.document.close();
    win.focus();
    win.print();
  };

  const handleDownload = () => {
    if (!detail) return;
    const headers = [
      'SN',
      'Order ID',
      'Transaction ID',
      ...(showVendor ? ['Vendor', 'Vendor Phone'] : []),
      'Receiver',
      'Destination',
      'Receiver Phone',
      'Receiver Address',
      'Weight',
      'COD',
      'Collected COD',
      'Delivery Charge',
    ];
    const rows = detail.items.map((item, index) => [
      index + 1,
      `#${item.orderNumber}`,
      item.trackingId,
      ...(showVendor ? [item.vendorName ?? '', item.vendorPhone ?? ''] : []),
      item.receiverName,
      hubNameOnly(item.destination || ''),
      item.receiverPhone,
      item.receiverAddress ?? '',
      item.weightKg === null ? '' : item.weightKg,
      item.codAmount,
      item.collectedAmount,
      item.deliveryCharge,
    ]);
    // Totals sit under the last three columns, so pad out however many
    // leading columns this variant of the sheet happens to have.
    const leadingBlanks = new Array(headers.length - 3).fill('');
    rows.push([...leadingBlanks, totals.cod, totals.collected, totals.deliveryCharge]);
    downloadExcel(`${detail.statementId}.xlsx`, 'Statement', headers, rows);
  };

  return (
    <div className="settlement-detail-page">
      <div className="settlement-detail-toolbar">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="settlement-detail-actions">
          {tab === 'billing' && (
            <>
              <Button variant="secondary" onClick={handlePrint} disabled={!detail}>
                <Printer size={16} /> Print
              </Button>
              <Button variant="secondary" onClick={handleDownload} disabled={!detail}>
                <Download size={16} /> Download
              </Button>
            </>
          )}
          {canEdit && detail?.status === 'pending' && (
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              <Pencil size={16} /> Edit
            </Button>
          )}
          {canPay && detail && isSettlementPayable(detail.status) && (
            <Button variant="primary" onClick={() => navigate(`/finance/settlements/${id}/pay`)}>
              <CreditCard size={16} />{' '}
              {detail.status === 'partially_paid'
                ? 'Pay Balance'
                : detail.payeeType === 'rider'
                  ? 'Record Payment'
                  : 'Make Payment'}
            </Button>
          )}
          {/* Cancelling releases the bundled orders, which would strand any
              money already recorded - so only an untouched statement. */}
          {canEdit && detail?.status === 'pending' && (
            <Button variant="danger" onClick={() => setShowCancel(true)}>
              <Ban size={16} /> Cancel
            </Button>
          )}
          {canEdit && detail && hasSettlementPayments(detail.status) && (
            <Button variant="danger" onClick={() => setShowRevert(true)}>
              <Undo2 size={16} /> Revert
            </Button>
          )}
        </div>
      </div>

      {banner && <ConfirmBanner title={banner.title} meta={banner.meta} onDismiss={() => setBanner(null)} />}

      {loading ? (
        <div className="sdp-bill sdp-skeleton" role="status" aria-label="Loading statement">
          <div className="sdp-bill-head">
            <span className="sdp-skeleton-bar sdp-skeleton-avatar" />
            <div className="sdp-payee-text">
              <span className="sdp-skeleton-bar" style={{ width: '160px', height: '18px' }} />
              <span className="sdp-skeleton-bar" style={{ width: '110px', height: '13px', marginTop: 'var(--space-2)' }} />
            </div>
          </div>
          <div className="sdp-meta">
            <span className="sdp-skeleton-bar" style={{ width: '100%', height: '14px' }} />
            <span className="sdp-skeleton-bar" style={{ width: '100%', height: '14px' }} />
          </div>
          <span className="sdp-skeleton-bar" style={{ width: '100%', height: '160px' }} />
        </div>
      ) : error ? (
        <p className="vendor-finance-error">{error}</p>
      ) : detail ? (
        <>
          {/* Riders are paid cash-in-hand with no paperwork trail - the
              receipt/invoice tabs only make sense for vendor payouts. */}
          {showDocumentTabs && (
            <SegmentedTabs
              ariaLabel="Statement view"
              fullWidth={false}
              minTabWidth="140px"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'billing', label: 'Billing details' },
                { value: 'receipt', label: 'Payment receipt' },
                { value: 'invoice', label: 'Tax invoice' },
              ]}
            />
          )}

          {tab === 'receipt' && showDocumentTabs ? (
            <DocumentTabPanel
              label="Payment receipt"
              only="receipt"
              settlementId={detail.id}
              documents={receipts}
              paymentCaptions={paymentCaptions}
              canAttach={canPay}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ) : tab === 'invoice' && showDocumentTabs ? (
            <DocumentTabPanel
              label="Tax invoice"
              only="taxInvoice"
              settlementId={detail.id}
              documents={taxInvoices}
              paymentCaptions={paymentCaptions}
              canAttach={canPay}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ) : (
            <div className="sdp-bill">
              <div className="sdp-bill-head">
                <span className="sdp-avatar">{initials(detail.payeeName || '?')}</span>
                <div className="sdp-payee-text">
                  <div className="sdp-payee-name-row">
                    <span className="sdp-payee-name">{detail.payeeName}</span>
                    <StatusChip variant="solid" tone={settlementStatusTone(detail.status)}>
                      {settlementStatusLabel(detail.status)}
                    </StatusChip>
                  </div>
                  <span className="sdp-payee-phone">{detail.payeePhone}</span>
                  {detail.payeeEmail && <span className="sdp-payee-sub">{detail.payeeEmail}</span>}
                  {detail.payeeAddress && <span className="sdp-payee-sub">{detail.payeeAddress}</span>}
                  {detail.payeePan && <span className="sdp-payee-sub">PAN: {detail.payeePan}</span>}
                </div>
              </div>

              <div className="sdp-meta">
                <div>
                  <span>Statement</span>
                  <span className="sdp-mono">{detail.statementId}</span>
                </div>
                <div>
                  <span>Statement date</span>
                  <span>{detail.transferDate ? toBsDate(detail.transferDate) : '-'}</span>
                </div>
                <div>
                  <span>Recorded</span>
                  <span>{toBsDateTime(detail.createdAt) || '-'}</span>
                </div>
                {hasSettlementPayments(detail.status) && detail.payments.length > 0 && (
                  <div>
                    <span>Payment method</span>
                    <span>
                      {detail.payments
                        .map((p) => {
                          // Method names are configurable now; show them as
                          // stored, capitalising legacy lowercase values.
                          const label = p.method.charAt(0).toUpperCase() + p.method.slice(1);
                          return `${label}: ${money(p.amount)}`;
                        })
                        .join(', ')}
                    </span>
                  </div>
                )}
                {/* Only worth stating while the two figures differ — on a
                    settled statement "paid" is just the payable again. */}
                {detail.status === 'partially_paid' && (
                  <>
                    <div>
                      <span>Paid so far</span>
                      <span>{money(detail.paidAmount)}</span>
                    </div>
                    <div>
                      <span>Still outstanding</span>
                      <span className="sdp-outstanding">{money(detail.remainingAmount)}</span>
                    </div>
                  </>
                )}
                {detail.remark && (
                  <div>
                    <span>Remark</span>
                    <span>{detail.remark}</span>
                  </div>
                )}
              </div>

              {/* Each act of paying, in the order it happened. A statement paid
                  in instalments would otherwise show only the roll-up, hiding
                  when each part arrived and which receipt proves which. */}
              {detail.paymentRecords.length > 0 && (
                <div className="sdp-payments">
                  <h3>Payment history</h3>
                  <div className="sdp-payments-list">
                    {detail.paymentRecords.map((payment, index) => (
                      <div className="sdp-payment" key={payment.id}>
                        <div className="sdp-payment-head">
                          <span className="sdp-payment-amount">{money(payment.amount)}</span>
                          <span className="sdp-payment-date">{toBsDateTime(payment.paidAt) || '-'}</span>
                        </div>
                        <div className="sdp-payment-meta">
                          <span>
                            {detail.paymentRecords.length > 1 ? `Payment ${index + 1} · ` : ''}
                            {payment.method}
                          </span>
                          {payment.documents.length > 0 && (
                            <span className="sdp-payment-proof">
                              <Paperclip size={12} />
                              {payment.documents.length} file{payment.documents.length > 1 ? 's' : ''} attached
                            </span>
                          )}
                        </div>
                        {payment.remark && <p className="sdp-payment-remark">{payment.remark}</p>}
                      </div>
                    ))}
                  </div>
                  {detail.remainingAmount > 0 && (
                    <p className="sdp-payments-outstanding">
                      {money(detail.remainingAmount)} still outstanding on this statement.
                    </p>
                  )}
                </div>
              )}

              {detail.items.length === 0 ? (
                <div className="loading-state">No orders linked to this settlement.</div>
              ) : (
                <div className="sdp-table-wrap">
                  <table className="sdp-table">
                    <thead>
                      <tr>
                        <th>SN</th>
                        <th>Order ID</th>
                        <th>Transaction ID</th>
                        <th>Order Type</th>
                        {showVendor && <th>Vendor</th>}
                        <th>Receiver</th>
                        <th>Destination</th>
                        <th>Number</th>
                        <th style={{ textAlign: 'right' }}>Weight</th>
                        <th style={{ textAlign: 'right' }}>COD</th>
                        <th style={{ textAlign: 'right' }}>Collected COD</th>
                        <th style={{ textAlign: 'right' }}>Delivery Charges</th>
                        <th style={{ textAlign: 'right' }}>Net Payable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((item, index) => (
                        <tr key={item.trackingId}>
                          <td>{index + 1}</td>
                          <td>#{item.orderNumber}</td>
                          <td>
                            <div className="sdp-mono">{item.trackingId}</div>
                            {item.deliveredAt && (
                              <div className="sdp-subtext">{toBsDateTime(item.deliveredAt)}</div>
                            )}
                          </td>
                          <td>
                            {item.isReturnToVendor ? (
                              <StatusChip tone="info">RTV</StatusChip>
                            ) : (
                              <span style={{ textTransform: 'capitalize' }}>{item.orderType || '-'}</span>
                            )}
                          </td>
                          {showVendor && (
                            <td>
                              {item.vendorName ?? '-'}
                              {item.vendorPhone && (
                                <div className="sdp-subtext">{item.vendorPhone}</div>
                              )}
                            </td>
                          )}
                          <td>
                            {item.receiverName}
                            {item.receiverAddress && (
                              <div className="sdp-subtext">{item.receiverAddress}</div>
                            )}
                          </td>
                          <td title={item.destination || '-'}>{hubNameOnly(item.destination || '') || '-'}</td>
                          <td>{item.receiverPhone}</td>
                          <td style={{ textAlign: 'right' }}>
                            {item.weightKg === null ? '-' : item.weightKg.toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right' }}>{money(item.codAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{money(item.collectedAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{money(item.deliveryCharge)}</td>
                          <td className="sdp-cell-strong" style={{ textAlign: 'right' }}>{money(item.settledAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="sdp-totals">
                <div>
                  <span>Total COD</span>
                  <span>{money(totals.cod)}</span>
                </div>
                <div>
                  <span>Collected COD</span>
                  <span>{money(totals.collected)}</span>
                </div>
                <div>
                  <span>Delivery Charges</span>
                  <span>{money(totals.deliveryCharge)}</span>
                </div>
                <div className="sdp-totals-payable">
                  <span>{detail.payeeType === 'rider' ? 'Receivable Amount' : 'Payable Amount'}</span>
                  <span>{money(detail.payableAmount)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      {showEdit && detail && (
        <EditSettlementModal
          settlementId={detail.id}
          payeeType={detail.payeeType}
          payeeId={detail.payeeId}
          currentItems={detail.items}
          onClose={() => setShowEdit(false)}
          onSuccess={() => setReloadKey((k) => k + 1)}
        />
      )}

      {showRevert && detail && (
        <RevertSettlementModal
          settlementId={detail.id}
          statementId={detail.statementId}
          mode="revert"
          onClose={() => setShowRevert(false)}
          onSuccess={() => {
            setReloadKey((k) => k + 1);
            setBanner({ title: `${detail.statementId} reverted to pending`, meta: 'Marked for payment again' });
          }}
        />
      )}

      {showCancel && detail && (
        <RevertSettlementModal
          settlementId={detail.id}
          statementId={detail.statementId}
          mode="cancel"
          onClose={() => setShowCancel(false)}
          onSuccess={() => {
            setReloadKey((k) => k + 1);
            setBanner({ title: `${detail.statementId} cancelled`, meta: 'Its orders are free for a future statement' });
          }}
        />
      )}
    </div>
  );
};

export default SettlementDetailPage;
