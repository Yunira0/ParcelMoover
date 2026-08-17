import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Plus, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import CreateTicketModal from '../components/CreateTicketModal';
import FilterDropdown from '../components/FilterDropdown';
import { isVendorSide } from '../utils/auth';
import {
  getTickets,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketsListMeta,
  type TicketStatus,
} from '../services/tickets.service';
import { toBsDate } from '../utils/nepaliDate';
import './Tickets.css';

type TicketTab = 'all' | TicketStatus;

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

// 'open' is a real workflow status (support has replied) but isn't offered as
// its own tab - having both "Pending" and "Open" read as the same thing to
// staff. Those tickets are still listed under "All" with an "Open" chip.
const TAB_ORDER: TicketTab[] = ['all', 'pending', 'closed'];

const TAB_LABELS: Record<TicketTab, string> = {
  all: 'All',
  ...TICKET_STATUS_LABELS,
};

const PRIORITY_TONE: Record<TicketPriority, StatusChipTone> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const STATUS_TONE: Record<TicketStatus, StatusChipTone> = {
  pending: 'warning',
  open: 'info',
  closed: 'success',
};

type DateRange = '' | 'today' | '7d' | '30d';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '', label: 'Select date range' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const RANGE_DAYS: Record<Exclude<DateRange, ''>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

// Converts the UI's coarse date-range picker into ISO-8601 bounds the API's
// fromDate/toDate accept, so filtering happens server-side instead of on a
// (potentially truncated) client-side page of results.
const dateRangeToBounds = (range: DateRange): { fromDate?: string; toDate?: string } => {
  if (!range) return {};
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RANGE_DAYS[range] - 1));
  return { fromDate: cutoff.toISOString(), toDate: new Date().toISOString() };
};

const Tickets: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Vendors raise tickets; admins/sales only triage them.
  const vendorSide = isVendorSide();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [meta, setMeta] = useState<TicketsListMeta | null>(null);
  const [activeTab, setActiveTab] = useState<TicketTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  // Deep-linked from a module's "Ticket" button, e.g. /tickets?category=pickup
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | ''>(() => {
    const fromUrl = searchParams.get('category');
    return fromUrl && fromUrl in TICKET_CATEGORY_LABELS ? (fromUrl as TicketCategory) : '';
  });
  const [dateRange, setDateRange] = useState<DateRange>('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [statusCounts, setStatusCounts] = useState<Record<TicketTab, number>>({
    all: 0,
    pending: 0,
    open: 0,
    closed: 0,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  // "?new=<category>" (e.g. from the vendor dashboard quick actions) opens the
  // create modal straight away with that category pre-selected.
  const newTicketParam = searchParams.get('new');
  const initialCreateCategory =
    newTicketParam && newTicketParam in TICKET_CATEGORY_LABELS ? (newTicketParam as TicketCategory) : undefined;
  const [isCreateOpen, setIsCreateOpen] = useState(newTicketParam !== null);

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    // Strip the deep-link param so a refresh doesn't reopen the modal.
    if (searchParams.has('new')) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  };

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => { setPage(1); }, [activeTab, debouncedSearch, priorityFilter, categoryFilter, dateRange, pageSizeChoice]);

  const { fromDate, toDate } = useMemo(() => dateRangeToBounds(dateRange), [dateRange]);

  // Guards against an earlier, slower request landing after a later one and
  // stomping its results (e.g. typing quickly in the search box).
  const loadRequestIdRef = useRef(0);

  const loadTickets = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const res = await getTickets({
        status: activeTab === 'all' ? undefined : activeTab,
        search: debouncedSearch || undefined,
        priority: priorityFilter || undefined,
        category: categoryFilter || undefined,
        fromDate,
        toDate,
        page,
        pageSize: pageSizeChoice,
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (res?.success && Array.isArray(res.data)) {
        setTickets(res.data);
        setMeta(res.meta ?? null);
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [activeTab, debouncedSearch, priorityFilter, categoryFilter, fromDate, toDate, page, pageSizeChoice]);

  // Tab counts respect search/priority/category/date filters (like Gmail label
  // counts) but not the active status tab itself, so switching tabs doesn't
  // change the numbers shown on the other tabs.
  const countsRequestIdRef = useRef(0);

  const loadStatusCounts = useCallback(async () => {
    const requestId = ++countsRequestIdRef.current;
    const filters = {
      search: debouncedSearch || undefined,
      priority: priorityFilter || undefined,
      category: categoryFilter || undefined,
      fromDate,
      toDate,
      pageSize: 1,
    };
    const [all, pending, open, closed] = await Promise.all([
      getTickets(filters),
      getTickets({ ...filters, status: 'pending' }),
      getTickets({ ...filters, status: 'open' }),
      getTickets({ ...filters, status: 'closed' }),
    ]);
    if (requestId !== countsRequestIdRef.current) return;
    setStatusCounts({
      all: all.meta?.total ?? 0,
      pending: pending.meta?.total ?? 0,
      open: open.meta?.total ?? 0,
      closed: closed.meta?.total ?? 0,
    });
  }, [debouncedSearch, priorityFilter, categoryFilter, fromDate, toDate]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadStatusCounts(); }, [loadStatusCounts]);

  const refresh = useCallback(() => {
    loadTickets();
    loadStatusCounts();
  }, [loadTickets, loadStatusCounts]);

  const totalPages = meta?.totalPages ?? 1;
  const visibleTickets = tickets;
  const visibleIds = visibleTickets.map((ticket) => ticket.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (ticketId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
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
    setPriorityFilter('');
    setCategoryFilter('');
    setDateRange('');
  };

  const columns = useMemo(() => [
    {
      header: 'SN',
      accessor: (ticket: Ticket) => ((page - 1) * pageSizeChoice) + visibleTickets.findIndex((row) => row.id === ticket.id) + 1,
      width: '50px',
      className: 'tickets-sn-cell',
    },
    { header: 'TICKET ID', accessor: (ticket: Ticket) => ticket.ticketId, width: '110px', className: 'tickets-id-cell' },
    // Vendors are the vendor themselves, so the Vendor column is only useful on
    // the admin/sales side.
    ...(vendorSide
      ? []
      : [{
          header: 'VENDOR',
          accessor: (ticket: Ticket) => (
            <div className="tickets-customer-cell">
              <span>{ticket.vendorName || ticket.customerName || '—'}</span>
              <small>{ticket.vendorPhone || ticket.customerPhone}</small>
            </div>
          ),
          width: '160px',
        }]),
    { header: 'REMARKS', accessor: (ticket: Ticket) => ticket.subject, width: '220px', className: 'tickets-subject-cell' },
    { header: 'CATEGORY', accessor: (ticket: Ticket) => TICKET_CATEGORY_LABELS[ticket.category], width: '110px' },
    {
      header: 'PRIORITY',
      accessor: (ticket: Ticket) => (
        <StatusChip tone={PRIORITY_TONE[ticket.priority]}>{TICKET_PRIORITY_LABELS[ticket.priority]}</StatusChip>
      ),
      width: '110px',
    },
    {
      header: 'STATUS',
      accessor: (ticket: Ticket) => (
        <StatusChip tone={STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABELS[ticket.status]}</StatusChip>
      ),
      width: '120px',
    },
    { header: 'CREATED AT', accessor: (ticket: Ticket) => toBsDate(ticket.createdAt), width: '110px' },
    {
      header: 'ACTION',
      accessor: (ticket: Ticket) => (
        <Button variant="outline" size="sm" onClick={() => navigate(`/tickets/${ticket.id}`)}>
          <Eye size={14} /> View
        </Button>
      ),
      width: '110px',
    },
  ], [page, pageSizeChoice, visibleTickets, navigate, vendorSide]);

  return (
    <div className="tickets-container">
      <PageHeader
        title="CX / Tickets"
        subtitle="Manage customer tickets, track status and resolve issues."
        actionLabel={vendorSide ? 'Create ticket' : undefined}
        actionIcon={vendorSide ? <Plus size={16} /> : undefined}
        onAction={vendorSide ? () => setIsCreateOpen(true) : undefined}
      />

      <SegmentedTabs
        ariaLabel="Ticket status filters"
        value={activeTab}
        onChange={setActiveTab}
        options={TAB_ORDER.map((tab) => ({ value: tab, label: `${TAB_LABELS[tab]} ${statusCounts[tab]}` }))}
      />

      <div className="tickets-filter-panel">
        <FilterDropdown
          label="PRIORITY"
          value={priorityFilter}
          onChange={(value) => setPriorityFilter(value as TicketPriority | '')}
          placeholder="Select priority"
          options={(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((priority) => ({
            value: priority,
            label: TICKET_PRIORITY_LABELS[priority],
          }))}
        />

        <FilterDropdown
          label="CATEGORY"
          value={categoryFilter}
          onChange={(value) => setCategoryFilter(value as TicketCategory | '')}
          placeholder="Select category"
          options={(Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map((category) => ({
            value: category,
            label: TICKET_CATEGORY_LABELS[category],
          }))}
        />

        <FilterDropdown
          label="DATE RANGE"
          value={dateRange}
          onChange={(value) => setDateRange(value as DateRange)}
          placeholder="Select date range"
          options={DATE_RANGE_OPTIONS.filter((opt) => opt.value).map((opt) => ({ value: opt.value, label: opt.label }))}
        />

        <Button variant="outline" className="clear-filter-btn" onClick={resetFilters}>
          Clear Filters
        </Button>
      </div>

      <label className="tickets-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search name, phone, email"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <Table
        columns={columns}
        data={visibleTickets}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading tickets..."
        emptyMessage="No tickets found."
        minWidth={vendorSide ? '940px' : '1100px'}
        tableClassName="tickets-table"
      />

      <Pagination
        ariaLabel="Tickets pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSizeChoice}
        pageSizeLabel="tickets"
        onPageSizeChange={setPageSizeChoice}
        summary={`${meta?.total ?? 0} ticket${(meta?.total ?? 0) === 1 ? '' : 's'}`}
      />

      <CreateTicketModal
        isOpen={isCreateOpen}
        onClose={closeCreateModal}
        onSuccess={refresh}
        initialCategory={initialCreateCategory}
      />
    </div>
  );
};

export default Tickets;
