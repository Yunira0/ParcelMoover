import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import Table from '../components/Table';
import FilterDropdown from '../components/FilterDropdown';
import ClearableFilter from '../components/ClearableFilter';
import Pagination from '../components/Pagination';
import { Banner } from './accounting/ui';
import { isSalesUser } from '../utils/auth';
import {
  COD_REQUEST_STATUS_LABELS,
  getCodSettlementRequestById,
  getCodSettlementRequests,
  getSettleableStatements,
  isLiveCodRequest,
  updateCodSettlementRequestStatus,
  type CodSettlementRequest,
  type CodSettlementRequestStatus,
  type SettleableStatement,
} from '../services/codSettlementRequests.service';
import ConfirmDialog from '../components/ConfirmDialog';
import { settlementStatusLabel } from '../utils/settlementStatus';
import { formatCurrency } from '../utils/format';
import { apiErrorMessage } from '../utils/serverValidation';
import { toBsDate } from '../utils/nepaliDate';
import { useSessionState } from '../hooks/useSessionState';
import './CodSettlementRequests.css';

// Staff side of vendor COD settlement requests.
//
// Actioning one does not move any money — the payout is still created through
// the existing settlement flow. Settling here records that the request was
// answered and releases the vendor's hold so they can ask again next cycle.

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...(Object.keys(COD_REQUEST_STATUS_LABELS) as CodSettlementRequestStatus[]).map((status) => ({
    value: status,
    label: COD_REQUEST_STATUS_LABELS[status],
  })),
];

const PAGE_SIZE = 20;

const CodSettlementRequests: React.FC = () => {
  // Sales sees its own vendors' requests read-only; settling stays with admins.
  const readOnly = isSalesUser();
  const [requests, setRequests] = useState<CodSettlementRequest[]>([]);
  // Kept for the browser tab, so leaving and coming back keeps the filter
  // until it is cleared by hand.
  const [status, setStatus] = useSessionState('cod-settlement-requests:status', '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CodSettlementRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // Settling names the statement that answers the request - see openSettle.
  const [settling, setSettling] = useState<CodSettlementRequest | null>(null);
  const [statementOptions, setStatementOptions] = useState<SettleableStatement[]>([]);
  const [statementChoice, setStatementChoice] = useState('');
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useSessionState('cod-settlement-requests:pageSize', PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCodSettlementRequests({
        page,
        pageSize,
        ...(status ? { status: status as CodSettlementRequestStatus } : {}),
      });
      setRequests(response.data);
      setTotal(response.meta.total);
      setTotalPages(response.meta.totalPages);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load COD settlement requests'));
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Notifications link to /cod-settlement-requests/:id. The request may be on
  // any page of the list, so it is fetched on its own and pinned above it.
  const { id: linkedId } = useParams();
  const [linked, setLinked] = useState<CodSettlementRequest | null>(null);
  useEffect(() => {
    if (!linkedId) {
      setLinked(null);
      return;
    }
    let active = true;
    getCodSettlementRequestById(linkedId)
      .then((response) => { if (active) setLinked(response.data); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, 'Could not open that request')); });
    return () => { active = false; };
  }, [linkedId, requests]);

  // Changing the status filter resets to the first page of the new result set.
  const changeStatus = (next: string) => {
    setStatus(next);
    setPage(1);
  };

  // Settling/rejecting the last request on a page (other than the first)
  // leaves `page` pointing past the end of the now-shorter list, which reads
  // as a blank table with a working "prev" button.
  useEffect(() => {
    if (!loading && requests.length === 0 && page > 1) setPage(1);
  }, [loading, requests.length, page]);

  const act = async (
    request: CodSettlementRequest,
    next: 'settled' | 'rejected',
    decisionNote?: string,
    settlementId?: string,
  ) => {
    setBusyId(request.id);
    setError(null);
    try {
      await updateCodSettlementRequestStatus(request.id, {
        status: next,
        ...(decisionNote ? { decisionNote } : {}),
        ...(settlementId ? { settlementId } : {}),
      });
      setRejecting(null);
      setRejectReason('');
      setSettling(null);
      setStatementChoice('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the request'));
    } finally {
      setBusyId(null);
    }
  };

  // Only statements that can still settle this: the server leaves out
  // cancelled ones and any already linked to another request.
  const openSettle = async (request: CodSettlementRequest) => {
    setRejecting(null);
    setSettling(request);
    setStatementChoice('');
    setStatementOptions([]);
    setStatementsLoading(true);
    try {
      setStatementOptions(await getSettleableStatements(request.id));
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load this vendor's statements"));
    } finally {
      setStatementsLoading(false);
    }
  };

  const closeSettle = useCallback(() => {
    setSettling(null);
    setStatementChoice('');
  }, []);

  const columns = [
    { header: 'REQUEST', accessor: (r: CodSettlementRequest) => r.requestNo, width: '140px' },
    { header: 'VENDOR', accessor: (r: CodSettlementRequest) => r.vendorName || '—', width: '160px' },
    {
      header: 'PAYOUT ACCOUNT',
      accessor: (r: CodSettlementRequest) => (
        <div className="cod-request-account">
          <span>{r.bankName}</span>
          <span>{r.accountNumber}</span>
          <span>{r.accountName}</span>
        </div>
      ),
      width: '200px',
    },
    {
      // Snapshot, not a live figure — labelled so nobody pays out against it.
      header: 'BALANCE WHEN ASKED',
      accessor: (r: CodSettlementRequest) =>
        r.amountSnapshot === null ? '—' : `Rs ${r.amountSnapshot.toLocaleString()}`,
      width: '160px',
    },
    {
      header: 'STATUS',
      accessor: (r: CodSettlementRequest) => COD_REQUEST_STATUS_LABELS[r.status],
      width: '110px',
    },
    { header: 'RAISED', accessor: (r: CodSettlementRequest) => toBsDate(r.createdAt) || '—', width: '110px' },
    {
      header: readOnly ? 'OUTCOME' : 'ACTIONS',
      accessor: (r: CodSettlementRequest) =>
        isLiveCodRequest(r.status) && !readOnly ? (
          <div className="cod-request-actions">
            {/* The action this queue exists for, so it takes the brand
                 colour and Reject stays outlined beside it. Without a variant
                 it fell back to `secondary` and the two read as equal choices.

                 There is no "Start" any more: marking a request in_progress
                 changed nothing the vendor or the books could see, and it left
                 a queue of half-actioned rows nobody closed. Requests already
                 started still show, and settle or reject the same way. */}
            <Button variant="primary" disabled={busyId === r.id} onClick={() => void openSettle(r)}>
              Settle
            </Button>
            <Button variant="outline" disabled={busyId === r.id} onClick={() => { setSettling(null); setRejecting(r); }}>
              Reject
            </Button>
          </div>
        ) : (
          <span className="cod-request-outcome">{r.decisionNote || r.settlementStatementId || '—'}</span>
        ),
      width: '200px',
    },
  ];

  return (
    <div className="cod-request-page">
      <header className="cod-request-header">
        <h1>
          <Banknote size={20} /> COD Settlement Requests
        </h1>
      </header>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="cod-request-toolbar">
        <ClearableFilter
          active={Boolean(status)}
          onClear={() => changeStatus('')}
          clearLabel="Clear status filter"
          align="end"
        >
          <FilterDropdown
            label="STATUS"
            value={status}
            options={STATUS_FILTER_OPTIONS}
            onChange={changeStatus}
            placeholder="All statuses"
          />
        </ClearableFilter>
      </div>

      <ConfirmDialog
        isOpen={Boolean(settling)}
        title={settling ? `Settle ${settling.requestNo}` : ''}
        confirmLabel="Confirm settle"
        busy={Boolean(settling) && busyId === settling?.id}
        confirmDisabled={!statementChoice}
        onConfirm={() => settling && void act(settling, 'settled', undefined, statementChoice)}
        onCancel={closeSettle}
      >
        <FormField
          label="Statement"
          required
          type="select"
          value={statementChoice}
          onChange={setStatementChoice}
          placeholder={
            statementsLoading
              ? 'Loading statements…'
              : statementOptions.length
                ? 'Choose a statement'
                : 'No unused statements for this vendor'
          }
          options={statementOptions.map((s) => ({
            value: s.id,
            label: `${s.statementId} · ${formatCurrency(s.amount)} · ${settlementStatusLabel(s.status)}`,
          }))}
        />
      </ConfirmDialog>

      {rejecting && (
        <section className="cod-request-card">
          <h2>Reject {rejecting.requestNo}</h2>
          <p>
            The vendor is blocked from raising another request until this closes, so tell them what to
            fix. They will see this reason.
          </p>
          <FormField
            label="Reason"
            required
            type="textarea"
            value={rejectReason}
            onChange={setRejectReason}
          />
          <div className="cod-request-actions">
            {/* Rejecting is destructive from the vendor's side — the vendor is
                told no and has to raise another. `danger`, not the brand
                colour: primary would invite the click. */}
            <Button
              variant="danger"
              disabled={!rejectReason.trim() || busyId === rejecting.id}
              onClick={() => act(rejecting, 'rejected', rejectReason.trim())}
            >
              Confirm rejection
            </Button>
            <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(''); }}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {linked && (
        <section className="cod-request-card">
          <h2>{linked.requestNo}</h2>
          <Table selectable={false} columns={columns} data={[linked]} minWidth="1080px" />
        </section>
      )}

      <Table selectable={false} columns={columns} data={requests} loading={loading} minWidth="1080px" />

      <Pagination
        ariaLabel="COD settlement requests pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeLabel="requests"
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        summary={`${total} request${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default CodSettlementRequests;
