import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import FilterDropdown from '../components/FilterDropdown';
import {
  getRemarks,
  setRemarkStatus,
  subscribeToRemarkStatusChanged,
  REMARK_STATUS_LABELS,
  type Remark,
  type RemarkStatus,
} from '../services/remarks.service';
import { toBsDate } from '../utils/nepaliDate';
import './Remarks.css';

const PAGE_SIZE = 10;

type RemarkTab = 'all' | 'unclosed' | RemarkStatus;

// pending (un-opened) → open (opened) → closed workflow. ("unclosed" is retained
// as a deep-link alias — any non-closed remark — but isn't shown as its own tab.)
const TAB_ORDER: RemarkTab[] = ['all', 'pending', 'open', 'closed'];

const TAB_LABELS: Record<RemarkTab, string> = {
  all: 'All',
  unclosed: 'Unclosed',
  ...REMARK_STATUS_LABELS,
};

const STATUS_TONE: Record<RemarkStatus, StatusChipTone> = {
  pending: 'warning',
  open: 'info',
  closed: 'success',
};

type DateRange = '' | 'today' | '7d' | '30d';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '', label: 'Select Date Range' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const RANGE_DAYS: Record<Exclude<DateRange, ''>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

const isWithinRange = (createdAt: string, range: DateRange) => {
  if (!range) return true;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RANGE_DAYS[range] - 1));
  return created.getTime() >= cutoff.getTime();
};

const Remarks: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  // Allow deep-linking to a specific status tab, e.g. /remarks?status=pending
  const statusParam = searchParams.get('status');
  const initialTab: RemarkTab =
    statusParam && (TAB_ORDER as string[]).includes(statusParam) ? (statusParam as RemarkTab) : 'all';
  const [activeTab, setActiveTab] = useState<RemarkTab>(initialTab);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const fromUrl = searchParams.get('dateRange');
    return fromUrl && fromUrl in RANGE_DAYS ? (fromUrl as DateRange) : '';
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  // Tracks the remark whose "Mark as Done" request is in flight, to disable just that button.
  const [markingDoneId, setMarkingDoneId] = useState<string | null>(null);

  // Keep tab/search/date-range bookmarkable - mirror into the URL (replacing
  // history, not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'all') next.set('status', activeTab);
    if (searchQuery) next.set('search', searchQuery);
    if (dateRange) next.set('dateRange', dateRange);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchQuery, dateRange, setSearchParams]);

  const loadRemarks = useCallback(async () => {
    setLoading(true);
    try {
      // This page computes tab counts/filters client-side over the fetched set,
      // so the default 20-row page silently made every tab (not just Unclosed)
      // undercount once there were more remarks than that - pull a much larger
      // page so counts reflect reality.
      const res = await getRemarks({ pageSize: 100 });
      if (res?.success && Array.isArray(res.data)) {
        setRemarks(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRemarks(); }, [loadRemarks]);
  useEffect(() => subscribeToRemarkStatusChanged(loadRemarks), [loadRemarks]);

  useEffect(() => { setPage(1); }, [searchQuery, activeTab, dateRange]);

  // Keep the active tab in sync with the ?status= param so re-navigating to it
  // (e.g. from the "Unclosed cmt" button) switches tabs without a remount.
  useEffect(() => {
    if (statusParam && (TAB_ORDER as string[]).includes(statusParam)) {
      setActiveTab(statusParam as RemarkTab);
    }
  }, [statusParam]);

  const statusCounts = useMemo(() => {
    const counts: Record<RemarkTab, number> = { all: remarks.length, unclosed: 0, pending: 0, open: 0, closed: 0 };
    remarks.forEach((remark) => {
      counts[remark.status] += 1;
      if (remark.status !== 'closed') counts.unclosed += 1;
    });
    return counts;
  }, [remarks]);

  const filteredRemarks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return remarks.filter((remark) => {
      if (activeTab === 'unclosed' && remark.status === 'closed') return false;
      if (activeTab !== 'all' && activeTab !== 'unclosed' && remark.status !== activeTab) return false;
      if (!isWithinRange(remark.createdAt, dateRange)) return false;
      if (q && !(
        remark.customerName.toLowerCase().includes(q) ||
        remark.customerPhone.toLowerCase().includes(q) ||
        remark.trackingId.toLowerCase().includes(q) ||
        remark.subject.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [remarks, searchQuery, activeTab, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filteredRemarks.length / PAGE_SIZE));
  const visibleRemarks = filteredRemarks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleIds = visibleRemarks.map((remark) => remark.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (remarkId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(remarkId)) {
        next.delete(remarkId);
      } else {
        next.add(remarkId);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const resetFilters = () => {
    setDateRange('');
  };

  const markAsDone = useCallback(async (remarkId: string) => {
    setMarkingDoneId(remarkId);
    try {
      await setRemarkStatus(remarkId, 'closed');
      // Update just this row locally so the status chip flips to "Closed" and the
      // button disappears, without a full-table reload.
      setRemarks((prev) =>
        prev.map((remark) => (remark.id === remarkId ? { ...remark, status: 'closed' } : remark)),
      );
    } finally {
      setMarkingDoneId(null);
    }
  }, []);

  const columns = useMemo(() => [
    {
      header: 'SN',
      accessor: (remark: Remark) => ((page - 1) * PAGE_SIZE) + visibleRemarks.findIndex((row) => row.id === remark.id) + 1,
      width: '50px',
      className: 'remarks-sn-cell',
    },
    { header: 'REMARK ID', accessor: (remark: Remark) => remark.remarkId, width: '110px', className: 'remarks-id-cell' },
    {
      header: 'TRACKING ID',
      accessor: (remark: Remark) => (
        <Link to={`/orders/track/${remark.trackingId}`} className="tracking-id-link">{remark.trackingId}</Link>
      ),
      width: '130px',
    },
    {
      header: 'VENDOR',
      accessor: (remark: Remark) => (
        <div className="remarks-customer-cell">
          <span>{remark.customerName}</span>
          <small>{remark.customerPhone}</small>
        </div>
      ),
      width: '160px',
    },
    { header: 'REMARKS', accessor: (remark: Remark) => remark.subject, width: '220px', className: 'remarks-subject-cell' },
    {
      header: 'LAST REMARK',
      accessor: (remark: Remark) => (
        <div className="remarks-last-cell">
          <span>{remark.lastRemark}</span>
          <small>{remark.lastRemarkBy} · {toBsDate(remark.lastRemarkAt)}</small>
        </div>
      ),
      width: '220px',
      className: 'remarks-subject-cell',
    },
    {
      header: 'STATUS',
      accessor: (remark: Remark) => (
        <StatusChip tone={STATUS_TONE[remark.status]}>{REMARK_STATUS_LABELS[remark.status]}</StatusChip>
      ),
      width: '140px',
    },
    { header: 'ADDED BY', accessor: (remark: Remark) => remark.addedBy, width: '140px' },
    { header: 'CREATED AT', accessor: (remark: Remark) => toBsDate(remark.createdAt), width: '110px' },
    {
      header: 'ACTION',
      accessor: (remark: Remark) => (
        <div className="remarks-action-cell">
          <Button variant="outline" size="sm" onClick={() => navigate(`/remarks/${remark.id}`)}>
            <Eye size={14} /> View
          </Button>
          {remark.status !== 'closed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAsDone(remark.id)}
              disabled={markingDoneId === remark.id}
            >
              <CheckCircle2 size={14} /> {markingDoneId === remark.id ? 'Saving…' : 'Mark as Done'}
            </Button>
          )}
        </div>
      ),
      width: '240px',
    },
  ], [page, visibleRemarks, navigate, markAsDone, markingDoneId]);

  return (
    <div className="remarks-container">
      <PageHeader
        title="Remarks"
        subtitle="Handle customer inquiries, monitor progress, and address concerns."
      />

      <SegmentedTabs
        ariaLabel="Remark status filters"
        value={activeTab}
        onChange={setActiveTab}
        options={TAB_ORDER.map((tab) => ({ value: tab, label: `${TAB_LABELS[tab]} ${statusCounts[tab]}` }))}
      />

      <div className="remarks-filter-panel">
        <FilterDropdown
          label="DATE RANGE"
          value={dateRange}
          onChange={(value) => setDateRange(value as DateRange)}
          placeholder="Select Date Range"
          options={DATE_RANGE_OPTIONS.filter((opt) => opt.value).map((opt) => ({ value: opt.value, label: opt.label }))}
        />

        <Button variant="outline" className="clear-filter-btn" onClick={resetFilters}>
          Clear Filters
        </Button>
      </div>

      <label className="remarks-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tracking id, sender name, phone"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <Table
        columns={columns}
        data={visibleRemarks}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading remarks..."
        emptyMessage="No remarks found."
        minWidth="1630px"
        tableClassName="remarks-table"
      />

      <Pagination
        ariaLabel="Remarks pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${filteredRemarks.length} remark${filteredRemarks.length === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default Remarks;
