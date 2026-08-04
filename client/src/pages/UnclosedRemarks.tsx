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
const SEARCH_DEBOUNCE_MS = 300;

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
  // Search hits the server (the list is paginated there), so debounce the input
  // rather than firing a request per keystroke.
  const [appliedSearch, setAppliedSearch] = useState(searchQuery.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [openCount, setOpenCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Tracks the remark whose "Mark as Done" request is in flight, to disable just that button.
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);

  const loadRemarks = useCallback(async () => {
    setLoading(true);
    try {
      // Paginate on the server. Fetching one big page and slicing it here capped
      // the list at the server's max page size, so once the backlog grew past
      // that the nav badge said "99+" while this page's total stopped short of it.
      // Server applies the canonical "unclosed" filter (status != closed,
      // vendor/rider-raised) - identical for every role and matching the
      // "Unclosed cmt" badge count, so closed remarks never leak into this list.
      const res = await getRemarks({
        unclosed: true,
        page,
        pageSize,
        search: appliedSearch || undefined,
      });
      if (res?.success && Array.isArray(res.data)) {
        setRemarks(res.data);
        setTotal(res.meta?.total ?? res.data.length);
        setTotalPages(res.meta?.totalPages ?? 1);
        // Counts come from the server over every page, not just the rows here.
        setOpenCount(res.meta?.statusCounts?.open ?? 0);
        setPendingCount(res.meta?.statusCounts?.pending ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch]);

  useEffect(() => { loadRemarks(); }, [loadRemarks]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => { setPage(1); }, [appliedSearch, pageSize]);

  // Closing the last remark on the final page leaves that page empty - step back
  // instead of showing an empty table with pages still listed behind it.
  useEffect(() => {
    if (!loading && page > totalPages) setPage(totalPages);
  }, [loading, page, totalPages]);

  const markAsDone = useCallback(async (remarkId: string) => {
    setMarkingDoneId(remarkId);
    try {
      await setRemarkStatus(remarkId, 'closed');
      // This page only lists unclosed remarks, so a newly-closed one drops off
      // the list; refetch so the totals and the following rows shift up with it.
      await loadRemarks();
    } finally {
      setMarkingDoneId(null);
    }
  }, [loadRemarks]);

  // Keep search bookmarkable - mirror into the URL (replacing history, not
  // pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (searchQuery) next.set('search', searchQuery);
    setSearchParams(next, { replace: true });
  }, [searchQuery, setSearchParams]);

  const visible = remarks;

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (r: Remark) => (page - 1) * pageSize + visible.findIndex((row) => row.id === r.id) + 1,
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
    [page, pageSize, visible, navigate, markAsDone, markingDoneId],
  );

  return (
    <div className="ucr-container">
      <PageHeader
        title="Unclosed Remarks"
        subtitle="All open and pending remarks that need attention."
      />

      <div className="ucr-stats">
        <div className="ucr-stat-chip">
          <span className="ucr-stat-value">{total}</span>
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
        pageSize={pageSize}
        pageSizeLabel="remarks"
        onPageSizeChange={setPageSize}
        summary={`${total} remark${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default UnclosedRemarks;
