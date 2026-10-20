import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import SegmentedTabs, { type SegmentedTabOption } from '../components/SegmentedTabs';
import {
  getRemarks,
  setRemarkStatus,
  REMARK_STATUS_LABELS,
  type Remark,
  type RemarkAuthorGroup,
  type RemarkStatus,
} from '../services/remarks.service';
import { toBsDate } from '../utils/nepaliDate';
import { isVendorSide } from '../utils/auth';
import './UnclosedRemarks.css';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_TONE: Record<RemarkStatus, StatusChipTone> = {
  open: 'info',
  pending: 'warning',
  closed: 'success',
};

type AuthorTab = 'all' | RemarkAuthorGroup;

const AUTHOR_TABS: SegmentedTabOption<AuthorTab>[] = [
  { value: 'all', label: 'All' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'rider', label: 'Rider' },
];

const parseAuthorTab = (value: string | null): AuthorTab =>
  value === 'vendor' || value === 'rider' ? value : 'all';

// One queue for vendor- and rider-raised comments. Staff can narrow it by
// author; vendors only ever work their own comments.
const UnclosedRemarks: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorSide = isVendorSide();
  const [authorTab, setAuthorTab] = useState<AuthorTab>(() => parseAuthorTab(searchParams.get('from')));
  const author: RemarkAuthorGroup | undefined = vendorSide ? 'vendor' : authorTab === 'all' ? undefined : authorTab;
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  // Search hits the server (the list is paginated there), so debounce the input
  // rather than firing a request per keystroke.
  const [appliedSearch, setAppliedSearch] = useState(searchQuery.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
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
        author,
        page,
        pageSize,
        search: appliedSearch || undefined,
      });
      if (res?.success && Array.isArray(res.data)) {
        setRemarks(res.data);
        setTotal(res.meta?.total ?? res.data.length);
        setTotalPages(res.meta?.totalPages ?? 1);
        // Counts come from the server over every page, not just the rows here.
        // Opened remarks aren't counted separately - "Open" alongside "Pending"
        // reads as the same thing to staff; both are covered by "Total unclosed".
        setPendingCount(res.meta?.statusCounts?.pending ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [author, page, pageSize, appliedSearch]);

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

  // Keep search and the author tab bookmarkable - mirror into the URL (replacing
  // history, not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (searchQuery) next.set('search', searchQuery);
    if (!vendorSide && authorTab !== 'all') next.set('from', authorTab);
    setSearchParams(next, { replace: true });
  }, [searchQuery, authorTab, vendorSide, setSearchParams]);

  const visible = remarks;

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (r: Remark) => (page - 1) * pageSize + visible.findIndex((row) => row.id === r.id) + 1,
        className: 'ucr-sn-cell',
      },
      {
        header: 'REMARK ID',
        accessor: (r: Remark) => r.remarkId,
        className: 'ucr-id-cell',
      },
      {
        header: 'TRACKING ID',
        accessor: (r: Remark) => (
          <Link to={`/orders/track/${r.trackingId}`} className="ucr-tracking-link">
            {r.trackingId}
          </Link>
        ),
      },
      {
        header: 'CUSTOMER',
        accessor: (r: Remark) => (
          <div className="ucr-customer-cell">
            <span>{r.customerName}</span>
            <small>{r.customerPhone}</small>
          </div>
        ),
      },
      { header: 'SUBJECT', accessor: (r: Remark) => r.subject, className: 'ucr-subject-cell' },
      {
        header: 'STATUS',
        accessor: (r: Remark) => (
          <StatusChip tone={STATUS_TONE[r.status]}>{REMARK_STATUS_LABELS[r.status]}</StatusChip>
        ),
      },
      { header: 'ADDED BY', accessor: (r: Remark) => r.addedBy },
      { header: 'CREATED AT', accessor: (r: Remark) => toBsDate(r.createdAt) },
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
      },
    ],
    [page, pageSize, visible, navigate, markAsDone, markingDoneId],
  );

  return (
    <div className="ucr-container">
      <PageHeader title="Unclosed Remarks" />

      {!vendorSide && (
        <SegmentedTabs
          options={AUTHOR_TABS}
          value={authorTab}
          onChange={(tab) => { setAuthorTab(tab); setPage(1); }}
          ariaLabel="Filter remarks by author"
          fullWidth={false}
        />
      )}

      <div className="ucr-stats">
        <div className="ucr-stat-chip">
          <span className="ucr-stat-value">{total}</span>
          <span className="ucr-stat-label">Total unclosed</span>
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
