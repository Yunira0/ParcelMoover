import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import FilterDropdown from '../components/FilterDropdown';
import {
  getRemarks,
  type Remark,
} from '../services/remarks.service';
import type { ParcelStatus } from '../services/orders.service';
import './Remarks.css';

const PAGE_SIZE = 10;

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
  oov: 'Out of Vehicle',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
};

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
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
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ParcelStatus | ''>('');
  const [dateRange, setDateRange] = useState<DateRange>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const loadRemarks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRemarks();
      if (res?.success && Array.isArray(res.data)) {
        setRemarks(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRemarks(); }, [loadRemarks]);

  useEffect(() => { setPage(1); }, [searchQuery, statusFilter, dateRange]);

  const filteredRemarks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return remarks.filter((remark) => {
      if (statusFilter && remark.status !== statusFilter) return false;
      if (!isWithinRange(remark.createdAt, dateRange)) return false;
      if (q && !(
        remark.customerName.toLowerCase().includes(q) ||
        remark.customerPhone.toLowerCase().includes(q) ||
        remark.trackingId.toLowerCase().includes(q) ||
        remark.subject.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [remarks, searchQuery, statusFilter, dateRange]);

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
    setStatusFilter('');
    setDateRange('');
  };

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
      header: 'CUSTOMER',
      accessor: (remark: Remark) => (
        <div className="remarks-customer-cell">
          <span>{remark.customerName}</span>
          <small>{remark.customerPhone}</small>
        </div>
      ),
      width: '160px',
    },
    { header: 'SUBJECT', accessor: (remark: Remark) => remark.subject, width: '220px', className: 'remarks-subject-cell' },
    {
      header: 'STATUS',
      accessor: (remark: Remark) => (
        <StatusChip tone={getStatusTone(remark.status)}>{STATUS_LABELS[remark.status]}</StatusChip>
      ),
      width: '140px',
    },
    { header: 'ADDED BY', accessor: (remark: Remark) => remark.addedBy, width: '140px' },
    { header: 'CREATED AT', accessor: (remark: Remark) => remark.createdAt, width: '110px' },
    {
      header: 'ACTION',
      accessor: (remark: Remark) => (
        <Button variant="outline" size="sm" onClick={() => navigate(`/remarks/${remark.id}`)}>
          <Eye size={14} /> View
        </Button>
      ),
      width: '110px',
    },
  ], [page, visibleRemarks, navigate]);

  return (
    <div className="remarks-container">
      <PageHeader
        title="Remarks"
        subtitle="Handle customer inquiries, monitor progress, and address concerns."
      />

      <div className="remarks-filter-panel">
        <FilterDropdown
          label="STATUS"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as ParcelStatus | '')}
          placeholder="Select status"
          options={(Object.keys(STATUS_LABELS) as ParcelStatus[]).map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
          }))}
        />

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
        minWidth="1280px"
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
