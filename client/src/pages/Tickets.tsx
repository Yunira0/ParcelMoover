import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  getTickets,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../services/tickets.service';
import { toBsDate } from '../utils/nepaliDate';
import './Tickets.css';

type TicketTab = 'all' | TicketStatus;

const PAGE_SIZE = 10;

const TAB_ORDER: TicketTab[] = ['all', 'open', 'pending', 'closed'];

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
  open: 'info',
  pending: 'warning',
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

const isWithinRange = (createdAt: string, range: DateRange) => {
  if (!range) return true;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RANGE_DAYS[range] - 1));
  return created.getTime() >= cutoff.getTime();
};

const Tickets: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTab, setActiveTab] = useState<TicketTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  // Deep-linked from a module's "Ticket" button, e.g. /tickets?category=pickup
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | ''>(() => {
    const fromUrl = searchParams.get('category');
    return fromUrl && fromUrl in TICKET_CATEGORY_LABELS ? (fromUrl as TicketCategory) : '';
  });
  const [dateRange, setDateRange] = useState<DateRange>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
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

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTickets();
      if (res?.success && Array.isArray(res.data)) {
        setTickets(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery, priorityFilter, categoryFilter, dateRange]);

  // Counts per tab are derived from the full dataset (independent of filters),
  // matching the design's status pills.
  const statusCounts = useMemo(() => {
    const counts: Record<TicketTab, number> = {
      all: tickets.length,
      open: 0,
      pending: 0,
      closed: 0,
    };
    tickets.forEach((ticket) => { counts[ticket.status] += 1; });
    return counts;
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (activeTab !== 'all' && ticket.status !== activeTab) return false;
      if (priorityFilter && ticket.priority !== priorityFilter) return false;
      if (categoryFilter && ticket.category !== categoryFilter) return false;
      if (!isWithinRange(ticket.createdAt, dateRange)) return false;
      if (q && !(
        ticket.vendorName.toLowerCase().includes(q) ||
        ticket.customerPhone.toLowerCase().includes(q) ||
        ticket.ticketId.toLowerCase().includes(q) ||
        ticket.subject.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [tickets, activeTab, searchQuery, priorityFilter, categoryFilter, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  const visibleTickets = filteredTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
      accessor: (ticket: Ticket) => ((page - 1) * PAGE_SIZE) + visibleTickets.findIndex((row) => row.id === ticket.id) + 1,
      width: '50px',
      className: 'tickets-sn-cell',
    },
    { header: 'TICKET ID', accessor: (ticket: Ticket) => ticket.ticketId, width: '110px', className: 'tickets-id-cell' },
    {
      header: 'VENDOR',
      accessor: (ticket: Ticket) => (
        <div className="tickets-customer-cell">
          <span>{ticket.vendorName || '—'}</span>
          <small>{ticket.customerPhone}</small>
        </div>
      ),
      width: '160px',
    },
    { header: 'SUBJECT', accessor: (ticket: Ticket) => ticket.subject, width: '220px', className: 'tickets-subject-cell' },
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
    { header: 'ASSIGNED TO', accessor: (ticket: Ticket) => ticket.assignedTo, width: '120px' },
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
  ], [page, visibleTickets, navigate]);

  return (
    <div className="tickets-container">
      <PageHeader
        title="CX / Tickets"
        subtitle="Manage customer tickets, track status and resolve issues."
        actionLabel="Create ticket"
        actionIcon={<Plus size={16} />}
        onAction={() => setIsCreateOpen(true)}
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
        minWidth="1280px"
        tableClassName="tickets-table"
      />

      <Pagination
        ariaLabel="Tickets pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${filteredTickets.length} ticket${filteredTickets.length === 1 ? '' : 's'}`}
      />

      <CreateTicketModal
        isOpen={isCreateOpen}
        onClose={closeCreateModal}
        onSuccess={loadTickets}
        initialCategory={initialCreateCategory}
      />
    </div>
  );
};

export default Tickets;
