import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Plus, Search } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import CreateTicketModal from '../components/CreateTicketModal';
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
import './Tickets.css';

type TicketTab = 'all' | TicketStatus;

const PAGE_SIZE = 10;

const TAB_ORDER: TicketTab[] = ['all', 'in_progress', 'pending', 'resolved', 'closed'];

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
  in_progress: 'info',
  pending: 'warning',
  resolved: 'success',
  closed: 'neutral',
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
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTab, setActiveTab] = useState<TicketTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | ''>('');
  const [dateRange, setDateRange] = useState<DateRange>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
      in_progress: 0,
      pending: 0,
      resolved: 0,
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
        ticket.customerName.toLowerCase().includes(q) ||
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
    setSearchQuery('');
    setPriorityFilter('');
    setCategoryFilter('');
    setDateRange('');
    setActiveTab('all');
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
      header: 'CUSTOMER',
      accessor: (ticket: Ticket) => (
        <div className="tickets-customer-cell">
          <span>{ticket.customerName}</span>
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
    { header: 'CREATED AT', accessor: (ticket: Ticket) => ticket.createdAt, width: '110px' },
    {
      header: 'ACTION',
      accessor: () => (
        <Button variant="outline" size="sm">
          <Eye size={14} /> View
        </Button>
      ),
      width: '110px',
    },
  ], [page, visibleTickets]);

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

      <div className="tickets-filters">
        <label className="tickets-search">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, phone, email"
          />
        </label>

        <select
          className="tickets-select"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as TicketPriority | '')}
          aria-label="Filter by priority"
        >
          <option value="">Select priority</option>
          {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((priority) => (
            <option key={priority} value={priority}>{TICKET_PRIORITY_LABELS[priority]}</option>
          ))}
        </select>

        <select
          className="tickets-select"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as TicketCategory | '')}
          aria-label="Filter by category"
        >
          <option value="">Select category</option>
          {(Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map((category) => (
            <option key={category} value={category}>{TICKET_CATEGORY_LABELS[category]}</option>
          ))}
        </select>

        <select
          className="tickets-select"
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value as DateRange)}
          aria-label="Filter by date range"
        >
          {DATE_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <Button variant="secondary" onClick={resetFilters}>Reset</Button>
      </div>

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
        onClose={() => setIsCreateOpen(false)}
        onSuccess={loadTickets}
      />
    </div>
  );
};

export default Tickets;
