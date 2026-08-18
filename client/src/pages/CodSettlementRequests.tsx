import React, { useCallback, useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import Table from '../components/Table';
import FilterDropdown from '../components/FilterDropdown';
import { Banner } from './accounting/ui';
import {
  COD_REQUEST_STATUS_LABELS,
  getCodSettlementRequests,
  isLiveCodRequest,
  updateCodSettlementRequestStatus,
  type CodSettlementRequest,
  type CodSettlementRequestStatus,
} from '../services/codSettlementRequests.service';
import { apiErrorMessage } from '../utils/serverValidation';
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

const CodSettlementRequests: React.FC = () => {
  const [requests, setRequests] = useState<CodSettlementRequest[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CodSettlementRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCodSettlementRequests({
        pageSize: 100,
        ...(status ? { status: status as CodSettlementRequestStatus } : {}),
      });
      setRequests(response.data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load COD settlement requests'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (
    request: CodSettlementRequest,
    next: 'in_progress' | 'settled' | 'rejected',
    decisionNote?: string,
  ) => {
    setBusyId(request.id);
    setError(null);
    try {
      await updateCodSettlementRequestStatus(request.id, {
        status: next,
        ...(decisionNote ? { decisionNote } : {}),
      });
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the request'));
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { header: 'REQUEST', accessor: (r: CodSettlementRequest) => r.requestNo, width: '170px' },
    { header: 'VENDOR', accessor: (r: CodSettlementRequest) => r.vendorName || '—' },
    {
      header: 'PAYOUT ACCOUNT',
      accessor: (r: CodSettlementRequest) => (
        <div className="cod-request-account">
          <span>{r.bankName}</span>
          <span>{r.accountNumber}</span>
          <span>{r.accountName}</span>
        </div>
      ),
    },
    {
      // Snapshot, not a live figure — labelled so nobody pays out against it.
      header: 'BALANCE WHEN ASKED',
      accessor: (r: CodSettlementRequest) =>
        r.amountSnapshot === null ? '—' : `Rs ${r.amountSnapshot.toLocaleString()}`,
      width: '150px',
    },
    {
      header: 'STATUS',
      accessor: (r: CodSettlementRequest) => COD_REQUEST_STATUS_LABELS[r.status],
      width: '120px',
    },
    { header: 'RAISED', accessor: (r: CodSettlementRequest) => r.createdAt.slice(0, 10), width: '120px' },
    {
      header: 'ACTIONS',
      accessor: (r: CodSettlementRequest) =>
        isLiveCodRequest(r.status) ? (
          <div className="cod-request-actions">
            {r.status === 'open' && (
              <Button variant="outline" disabled={busyId === r.id} onClick={() => act(r, 'in_progress')}>
                Start
              </Button>
            )}
            <Button disabled={busyId === r.id} onClick={() => act(r, 'settled')}>
              Settle
            </Button>
            <Button variant="outline" disabled={busyId === r.id} onClick={() => setRejecting(r)}>
              Reject
            </Button>
          </div>
        ) : (
          <span className="cod-request-outcome">{r.decisionNote || r.settlementStatementId || '—'}</span>
        ),
      width: '230px',
    },
  ];

  return (
    <div className="cod-request-page">
      <header className="cod-request-header">
        <h1>
          <Banknote size={20} /> COD Settlement Requests
        </h1>
        <p>
          Vendors asking to be paid out. Settling or rejecting a request releases their hold and lets
          them raise the next one — the payout itself is still recorded through Settlements.
        </p>
      </header>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="cod-request-toolbar">
        <FilterDropdown
          label="STATUS"
          value={status}
          options={STATUS_FILTER_OPTIONS}
          onChange={setStatus}
          placeholder="All statuses"
        />
      </div>

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
            <Button
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

      <Table columns={columns} data={requests} loading={loading} />
    </div>
  );
};

export default CodSettlementRequests;
