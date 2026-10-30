import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Eye, Ticket as TicketIcon } from 'lucide-react';
import Table from '../Table';
import Button from '../Button';
import Pagination from '../Pagination';
import SegmentedTabs from '../SegmentedTabs';
import StatusChip, { type StatusChipTone } from '../StatusChip';
import {
  getTickets,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../../services/tickets.service';
import { queryKeys } from '../../queries/keys';
import { toBsDate } from '../../utils/nepaliDate';
import { canOpenPath } from '../../utils/auth';
import './StageTickets.css';

// Each operations page offers its stage's tickets through a Tickets button in
// its header, which swaps the parcel table for the tickets list; picking a
// parcel tab swaps back. The page keeps `?view=tickets` in its URL so coming
// back from a ticket's detail page lands on the tickets again.
export const TICKETS_TAB = 'tickets' as const;
export type TicketsTab = typeof TICKETS_TAB;

type StatusFilter = 'all' | TicketStatus;

// Pending (not yet opened by staff) leads: it is the stage's work queue.
const STATUS_FILTERS: StatusFilter[] = ['pending', 'open', 'closed', 'all'];
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { all: 'All', ...TICKET_STATUS_LABELS };

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

const PAGE_SIZE = 10;

const useStageTicketCounts = (category: TicketCategory) =>
  useQuery({
    queryKey: queryKeys.tickets.stageCounts(category),
    queryFn: async () => (await getTickets({ category, pageSize: 1 })).meta.categoryStatusCounts ?? null,
  });

interface StageTicketsButtonProps {
  category: TicketCategory;
  active: boolean;
  onClick: () => void;
}

/** The page header's Tickets toggle, badged with what still waits on staff (pending + open). */
export const StageTicketsButton: React.FC<StageTicketsButtonProps> = ({ category, active, onClick }) => {
  const counts = useStageTicketCounts(category).data;
  const waiting = counts ? counts.pending + counts.open : 0;
  const badge = waiting > 99 ? '99+' : String(waiting);
  return (
    <Button
      variant="outline"
      className={`stage-tickets-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Tickets${waiting > 0 ? `, ${badge} waiting` : ''}`}
    >
      <TicketIcon size={16} />
      Tickets
      {waiting > 0 && <span className="stage-tickets-badge" aria-hidden="true">{badge}</span>}
    </Button>
  );
};

interface StageTicketsPanelProps {
  category: TicketCategory;
}

export const StageTicketsPanel: React.FC<StageTicketsPanelProps> = ({ category }) => {
  const navigate = useNavigate();
  const [pickedStatus, setStatus] = useState<StatusFilter | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const countsQuery = useStageTicketCounts(category);
  const counts = countsQuery.data;

  // Until staff pick a filter, open on the first one with tickets in it, so a
  // stage whose tickets are all Open doesn't land on an empty Pending list.
  const status: StatusFilter = pickedStatus
    ?? (!counts || counts.pending > 0 ? 'pending' : counts.open > 0 ? 'open' : 'all');

  useEffect(() => { setPage(1); }, [status, pageSize]);

  const params = { category, status: status === 'all' ? undefined : status, page, pageSize };
  const listQuery = useQuery({
    queryKey: queryKeys.tickets.list(params),
    queryFn: () => getTickets(params),
    placeholderData: keepPreviousData,
    // Wait for the counts that pick the default filter, so the list isn't
    // fetched twice on open.
    enabled: pickedStatus !== null || !countsQuery.isPending,
  });
  const tickets = useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);
  const meta = listQuery.data?.meta;

  const columns = useMemo(() => [
    { header: 'TICKET ID', accessor: (t: Ticket) => t.ticketId, width: '150px', className: 'stage-tickets-id-cell' },
    {
      header: 'VENDOR',
      accessor: (t: Ticket) => (
        <div className="stage-tickets-vendor-cell">
          <span>{t.vendorName || t.customerName || '—'}</span>
          <small>{t.vendorPhone || t.customerPhone}</small>
        </div>
      ),
      width: '180px',
    },
    { header: 'SUBJECT', accessor: (t: Ticket) => t.subject, width: '240px', className: 'stage-tickets-subject-cell' },
    {
      header: 'TRACKING ID',
      accessor: (t: Ticket) => t.trackingId
        ? <Link to={`/orders/track/${t.trackingId}`} className="tracking-id-link">{t.trackingId}</Link>
        : '—',
      width: '140px',
    },
    {
      header: 'PRIORITY',
      accessor: (t: Ticket) => <StatusChip tone={PRIORITY_TONE[t.priority]}>{TICKET_PRIORITY_LABELS[t.priority]}</StatusChip>,
      width: '110px',
    },
    {
      header: 'STATUS',
      accessor: (t: Ticket) => <StatusChip tone={STATUS_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status]}</StatusChip>,
      width: '110px',
    },
    { header: 'CREATED AT', accessor: (t: Ticket) => toBsDate(t.createdAt), width: '110px' },
    {
      header: 'ACTION',
      accessor: (t: Ticket) => (
        <Button variant="outline" size="sm" onClick={() => navigate(`/tickets/${t.id}`)}>
          <Eye size={14} /> View
        </Button>
      ),
      width: '100px',
    },
  ], [navigate]);

  return (
    <div className="stage-tickets">
      <div className="stage-tickets-toolbar">
        <SegmentedTabs
          ariaLabel="Ticket status filters"
          fullWidth={false}
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s], count: counts?.[s] }))}
        />
        {canOpenPath('/tickets') && (
          <Link to={`/tickets?category=${category}`} className="stage-tickets-all-link">
            Open in Tickets
          </Link>
        )}
      </div>

      {listQuery.isError ? (
        <div className="stage-tickets-error">
          <span>Couldn't load tickets.</span>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>Try again</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          data={tickets}
          selectable={false}
          loading={listQuery.isPending}
          loadingMessage="Loading tickets..."
          emptyMessage={status === 'all' ? 'No tickets for this stage yet.' : `No ${STATUS_FILTER_LABELS[status].toLowerCase()} tickets.`}
          minWidth="1000px"
        />
      )}

      <Pagination
        ariaLabel="Stage tickets pagination"
        page={page}
        totalPages={meta?.totalPages ?? 1}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeLabel="tickets"
        onPageSizeChange={setPageSize}
        summary={`${meta?.total ?? 0} ticket${(meta?.total ?? 0) === 1 ? '' : 's'}`}
      />
    </div>
  );
};
