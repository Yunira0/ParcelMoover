import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getRemarks,
  setRemarkStatus,
  REMARK_STATUS_LABELS,
  type Remark,
  type RemarkStatus,
} from '../services/remarks.service';
import { toBsDate } from '../utils/nepaliDate';
import './UnclosedRemarks.css';

const PAGE_SIZE = 10;

const STATUS_TONE: Record<RemarkStatus, StatusChipTone> = {
  open: 'info',
  pending: 'warning',
  closed: 'success',
};

const UnclosedRemarks: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Tracks the remark whose "Mark as Done" request is in flight, to disable just that button.
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);

  const loadRemarks = useCallback(async () => {
    setLoading(true);
    try {
      // Filter unclosed server-side (not just "the latest 20 of any status") -
      // otherwise a page full of recently-closed remarks pushes older unclosed
      // ones off this list entirely while the nav badge's true DB count stays high.
      // Server applies the canonical "unclosed" filter (status != closed,
      // vendor/rider-raised) - identical for every role and matching the
      // "Unclosed cmt" badge count, so closed remarks never leak into this list.
      const res = await getRemarks({ unclosed: true, pageSize: 100 });
      if (res?.success && Array.isArray(res.data)) {
        setRemarks(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRemarks(); }, [loadRemarks]);
  useEffect(() => { setPage(1); }, [searchQuery]);

  const markAsDone = useCallback(async (remarkId: string) => {
    setMarkingDoneId(remarkId);
    try {
      await setRemarkStatus(remarkId, 'closed');
      // This page only lists unclosed remarks, so a newly-closed one drops off the list.
      setRemarks((prev) => prev.filter((remark) => remark.id !== remarkId));
    } finally {
      setMarkingDoneId(null);
    }
  }, []);

  // Keep search bookmarkable - mirror into the URL (replacing history, not
  // pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (searchQuery) next.set('search', searchQuery);
    setSearchParams(next, { replace: true });
  }, [searchQuery, setSearchParams]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return remarks
      .filter((r) => r.status !== 'closed')
      .filter((r) => !q ||
        r.customerName.toLowerCase().includes(q) ||
        r.customerPhone.toLowerCase().includes(q) ||
        r.trackingId.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q),
      );
  }, [remarks, searchQuery]);

  const openCount = filtered.filter((r) => r.status === 'open').length;
  const pendingCount = filtered.filter((r) => r.status === 'pending').length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (r: Remark) => (page - 1) * PAGE_SIZE + visible.findIndex((row) => row.id === r.id) + 1,
        width: '50px',
        className: 'ucr-sn-cell',
      },
      {
        header: 'REMARK ID',
        accessor: (r: Remark) => r.remarkId,
        width: '110px',
        className: 'ucr-id-cell',
      },
      {
        header: 'TRACKING ID',
        accessor: (r: Remark) => (
          <Link to={`/orders/track/${r.trackingId}`} className="ucr-tracking-link">
            {r.trackingId}
          </Link>
        ),
        width: '130px',
      },
      {
        header: 'CUSTOMER',
        accessor: (r: Remark) => (
          <div className="ucr-customer-cell">
            <span>{r.customerName}</span>
            <small>{r.customerPhone}</small>
          </div>
        ),
        width: '160px',
      },
      { header: 'SUBJECT', accessor: (r: Remark) => r.subject, width: '220px', className: 'ucr-subject-cell' },
      {
        header: 'STATUS',
        accessor: (r: Remark) => (
          <StatusChip tone={STATUS_TONE[r.status]}>{REMARK_STATUS_LABELS[r.status]}</StatusChip>
        ),
        width: '120px',
      },
      { header: 'ADDED BY', accessor: (r: Remark) => r.addedBy, width: '140px' },
      { header: 'CREATED AT', accessor: (r: Remark) => toBsDate(r.createdAt), width: '110px' },
      {
        header: 'ACTION',
        accessor: (r: Remark) => (
          <div className="ucr-action-cell">
            <Button variant="outline" size="sm" onClick={() => navigate(`/remarks/${r.id}`)}>
              <Eye size={14} /> View
            </Button>
            {r.status !== 'closed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAsDone(r.id)}
                disabled={markingDoneId === r.id}
              >
                <CheckCircle2 size={14} /> {markingDoneId === r.id ? 'Saving…' : 'Mark as Done'}
              </Button>
            )}
          </div>
        ),
        width: '240px',
      },
    ],
    [page, visible, navigate, markAsDone, markingDoneId],
  );

  return (
    <div className="ucr-container">
      <PageHeader
        title="Unclosed Remarks"
        subtitle="All open and pending remarks that need attention."
      />

      <div className="ucr-stats">
        <div className="ucr-stat-chip">
          <span className="ucr-stat-value">{filtered.length}</span>
          <span className="ucr-stat-label">Total unclosed</span>
        </div>
        <div className="ucr-stat-chip ucr-stat-open">
          <span className="ucr-stat-value">{openCount}</span>
          <span className="ucr-stat-label">Open</span>
        </div>
        <div className="ucr-stat-chip ucr-stat-pending">
          <span className="ucr-stat-value">{pendingCount}</span>
          <span className="ucr-stat-label">Pending</span>
        </div>
      </div>

      <label className="ucr-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tracking id, name, phone, subject"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <Table
        columns={columns}
        data={visible}
        selectable={false}
        loading={loading}
        loadingMessage="Loading remarks..."
        emptyMessage="No unclosed remarks found."
        minWidth="1340px"
        tableClassName="ucr-table"
      />

      <Pagination
        ariaLabel="Unclosed remarks pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${filtered.length} remark${filtered.length === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default UnclosedRemarks;
