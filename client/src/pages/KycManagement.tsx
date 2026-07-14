import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Eye, X, FileText, ExternalLink } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Table from '../components/Table';
import StatusChip from '../components/StatusChip';
import SegmentedTabs from '../components/SegmentedTabs';
import Button from '../components/Button';
import {
  getKycApplications,
  approveKyc,
  rejectKyc,
  type KycApplication,
} from '../services/kyc.service';
import { toBsDate } from '../utils/nepaliDate';
import './KycManagement.css';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') ?? 'http://localhost:3000';

const DocLink: React.FC<{ path: string | null; label: string }> = ({ path, label }) => {
  if (!path) return <span className="kyc-doc-missing">—</span>;
  // Strip any leading absolute path segments — only keep from "uploads/" onward
  const relative = path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1');
  return (
    <a
      href={`${API_BASE}/${relative}`}
      target="_blank"
      rel="noreferrer"
      className="kyc-doc-link"
    >
      <FileText size={14} /> {label} <ExternalLink size={12} />
    </a>
  );
};

const KycManagement: React.FC = () => {
  const [applications, setApplications] = useState<KycApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KycApplication | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionModal, setActionModal] = useState<'approve' | 'reject' | null>(null);
  const [notes, setNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getKycApplications(statusFilter === 'all' ? undefined : statusFilter);
      setApplications(res.data ?? []);
    } catch {
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (app: KycApplication) => {
    setSelected(app);
    setDetailOpen(true);
    setActionModal(null);
    setNotes('');
    setRejectionReason('');
    setActionError('');
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setSelected(null);
    setActionModal(null);
  };

  const startAction = (mode: 'approve' | 'reject') => {
    setActionModal(mode);
    setNotes('');
    setRejectionReason('');
    setActionError('');
  };

  const handleApprove = async () => {
    if (!selected) return;
    setSubmitting(true);
    setActionError('');
    try {
      await approveKyc(selected.id, notes || undefined);
      closeDetail();
      load();
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'Failed to approve application.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    if (!rejectionReason.trim()) { setActionError('Rejection reason is required.'); return; }
    setSubmitting(true);
    setActionError('');
    try {
      await rejectKyc(selected.id, rejectionReason, notes || undefined);
      closeDetail();
      load();
    } catch (err: any) {
      setActionError(err?.response?.data?.message || 'Failed to reject application.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { header: 'ID', accessor: (a: KycApplication) => a.sn, width: '48px' },
    { header: 'Business', accessor: (a: KycApplication) => (
      <div>
        <div className="kyc-cell-primary">{a.onlineBusinessName}</div>
        <div className="kyc-cell-sub">{a.pickupLocation}</div>
      </div>
    )},
    { header: 'Owner', accessor: (a: KycApplication) => (
      <div>
        <div className="kyc-cell-primary">{a.ownerName}</div>
        <div className="kyc-cell-sub">{a.ownerContact}</div>
      </div>
    )},
    { header: 'Email', accessor: (a: KycApplication) => a.ownerEmail },
    { header: 'Status', accessor: (a: KycApplication) => (
      <StatusChip tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'}>
        {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
      </StatusChip>
    ), width: '100px' },
    { header: 'Submitted', accessor: (a: KycApplication) => toBsDate(a.createdAt), width: '110px' },
    { header: '', accessor: (a: KycApplication) => (
      <button className="kyc-view-btn" onClick={() => openDetail(a)} title="View details">
        <Eye size={15} />
      </button>
    ), width: '48px' },
  ];

  return (
    <div className="kyc-management">
      <PageHeader
        title="KYC Applications"
        subtitle="Review and approve vendor onboarding applications"
      />

      <SegmentedTabs
        options={STATUS_TABS}
        value={statusFilter}
        onChange={setStatusFilter}
        ariaLabel="Filter by status"
        fullWidth={false}
        minTabWidth="100px"
      />

      <Table
        columns={columns}
        data={applications}
        loading={loading}
        loadingMessage="Loading applications…"
        emptyMessage="No applications found."
        minWidth="700px"
      />

      {detailOpen && selected && (
        <div className="kyc-modal-overlay" onClick={closeDetail}>
          <div className="kyc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kyc-modal-header">
              <div>
                <h2>{selected.onlineBusinessName}</h2>
                <StatusChip tone={selected.status === 'approved' ? 'success' : selected.status === 'rejected' ? 'danger' : 'warning'}>
                  {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                </StatusChip>
              </div>
              <button className="kyc-modal-close" onClick={closeDetail}><X size={18} /></button>
            </div>

            <div className="kyc-modal-body">
              <div className="kyc-detail-section">
                <h4>Business Details</h4>
                <DetailRow label="Business Name" value={selected.onlineBusinessName} />
                <DetailRow label="Pickup Location" value={selected.pickupLocation} />
                {selected.pickupLandmark && <DetailRow label="Landmark" value={selected.pickupLandmark} />}
                <DetailRow label="Contact No." value={selected.businessContact} />
              </div>

              <div className="kyc-detail-section">
                <h4>Owner Details</h4>
                <DetailRow label="Owner Name" value={selected.ownerName} />
                <DetailRow label="Gmail" value={selected.ownerEmail} />
                <DetailRow label="Contact No." value={selected.ownerContact} />
              </div>

              <div className="kyc-detail-section">
                <h4>Billing Details</h4>
                <DetailRow label="Business Name" value={selected.billingBusinessName || '—'} />
                <DetailRow label="Reg. Address" value={selected.registeredAddress || '—'} />
                <DetailRow label="Reg. No." value={selected.registrationNo || '—'} />
                <DetailRow label="PAN / VAT No." value={selected.panVatNo || '—'} />
              </div>

              <div className="kyc-detail-section">
                <h4>Documents</h4>
                <div className="kyc-docs-grid">
                  <div className="kyc-doc-item">
                    <span className="kyc-doc-label">Citizenship</span>
                    <DocLink path={selected.citizenshipDoc} label="View" />
                  </div>
                  <div className="kyc-doc-item">
                    <span className="kyc-doc-label">PAN / VAT</span>
                    <DocLink path={selected.panVatDoc} label="View" />
                  </div>
                  <div className="kyc-doc-item">
                    <span className="kyc-doc-label">Business Cert.</span>
                    <DocLink path={selected.businessCertDoc} label="View" />
                  </div>
                </div>
              </div>

              <div className="kyc-detail-section">
                <h4>Bank Details</h4>
                <DetailRow label="Bank Name" value={selected.bankName || '—'} />
                <DetailRow label="Account No." value={selected.bankAccountNo || '—'} />
                <DetailRow label="Account Holder" value={selected.bankAccountHolder || '—'} />
              </div>

              {selected.status === 'rejected' && selected.rejectionReason && (
                <div className="kyc-detail-section kyc-rejection-info">
                  <h4>Rejection Reason</h4>
                  <p>{selected.rejectionReason}</p>
                  {selected.notes && <p className="kyc-notes">{selected.notes}</p>}
                </div>
              )}

              {actionModal === 'approve' && (
                <div className="kyc-action-form">
                  <label>Internal Notes (optional)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes for internal reference…" rows={3} />
                  {actionError && <p className="kyc-action-error">{actionError}</p>}
                  <div className="kyc-action-buttons">
                    <Button variant="secondary" onClick={() => setActionModal(null)} disabled={submitting}>Cancel</Button>
                    <Button variant="primary" onClick={handleApprove} disabled={submitting}>
                      {submitting ? 'Approving…' : 'Confirm Approval'}
                    </Button>
                  </div>
                </div>
              )}

              {actionModal === 'reject' && (
                <div className="kyc-action-form">
                  <label>Rejection Reason <span className="required">*</span></label>
                  <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Explain why this application is being rejected…" rows={3} required />
                  <label>Internal Notes (optional)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes for internal reference…" rows={2} />
                  {actionError && <p className="kyc-action-error">{actionError}</p>}
                  <div className="kyc-action-buttons">
                    <Button variant="secondary" onClick={() => setActionModal(null)} disabled={submitting}>Cancel</Button>
                    <Button variant="danger" onClick={handleReject} disabled={submitting}>
                      {submitting ? 'Rejecting…' : 'Confirm Rejection'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {selected.status === 'pending' && !actionModal && (
              <div className="kyc-modal-footer">
                <Button variant="secondary" onClick={() => startAction('reject')}>
                  <XCircle size={15} /> Reject
                </Button>
                <Button variant="primary" onClick={() => startAction('approve')}>
                  <CheckCircle size={15} /> Approve
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="kyc-detail-row">
    <span className="kyc-detail-label">{label}</span>
    <span className="kyc-detail-value">{value}</span>
  </div>
);

export default KycManagement;
