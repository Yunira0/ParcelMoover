import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import SearchableSelect, { type SearchableSelectOption } from '../../components/SearchableSelect';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import { Banner } from '../accounting/ui';
import { money } from '../accounting/format';
import { useBranchScope } from '../../context/BranchScopeContext';
import { getCurrentUserLocationId, getCurrentUserRoles, isBranchWorkspaceUser } from '../../utils/auth';
import {
  getBranchSettlements,
  type BranchSettlement,
  type BranchSettlementStatus,
} from '../../services/branchTracking.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import '../accounting/Accounting.css';

const PAGE_SIZE = 20;

/** A row as the table sees it: the statement plus its serial number on the page. */
type SettlementRow = BranchSettlement & { sn: number };

const BranchSettlement: React.FC = () => {
  const navigate = useNavigate();
  const { fromBranchId, setFromBranchId, branches, loading } = useBranchScope();

  // A branch workspace only ever sees its own branch's statements (the server
  // scopes them), so the paying-branch filter is offered only to Imadol /
  // super admin, who see every branch.
  const isBranchWorkspace = isBranchWorkspaceUser();
  // Both sides create statements (see assertCanCreateBranchSettlement): a branch
  // workspace for its own COD, a super admin or Imadol master-branch admin for
  // any branch. A head-office admin on some other hub cannot.
  const ownLocationId = getCurrentUserLocationId();
  const masterBranchId = branches.find((branch) => branch.code?.trim().toUpperCase() === 'IMADOL')?.id;
  const canCreateSettlement = isBranchWorkspace
    || getCurrentUserRoles().includes('super_admin')
    || (Boolean(ownLocationId) && ownLocationId === masterBranchId);

  // Branch is the party filter (mirrors the rider/vendor filter on Rider COD);
  // status and one settlement date are applied server-side alongside it.
  const [settlementDate, setSettlementDate] = useState('');
  const [status, setStatus] = useState<BranchSettlementStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [items, setItems] = useState<BranchSettlement[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingRows, setLoadingRows] = useState(true);
  const [error, setError] = useState('');

  const branchOptions: SearchableSelectOption[] = [
    { id: 'all', label: 'All paying branches' },
    ...branches.map((branch) => ({ id: branch.id, label: branch.name, description: branch.district ?? undefined })),
  ];

  /** Any filter change puts you back on page 1 — page 4 of the old result is meaningless. */
  const applyFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading state
    setLoadingRows(true);
    setError('');
    getBranchSettlements({
      ...(fromBranchId !== 'all' ? { fromBranchId } : {}),
      ...(settlementDate ? { dateFrom: settlementDate, dateTo: settlementDate } : {}),
      ...(status ? { status } : {}),
      page,
      pageSize,
    }, controller.signal)
      .then((response) => {
        setItems(response.data);
        setTotal(response.meta.total);
        setTotalPages(response.meta.totalPages);
        setError('');
      })
      .catch(() => {
        // A superseded request (filter change, or React's dev double-mount)
        // aborts - that is not a load failure, so it must not raise the banner.
        if (!controller.signal.aborted) setError('Failed to load branch settlements.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRows(false);
      });
    return () => controller.abort();
  }, [fromBranchId, settlementDate, status, page, pageSize]);

  const rows: SettlementRow[] = useMemo(
    () => items.map((item, index) => ({ ...item, sn: (page - 1) * pageSize + index + 1 })),
    [items, page, pageSize],
  );

  return (
    <div className="acc-page">
      <PageHeader
        title="Branch COD"
        subtitle="COD statements a collecting branch owes the Imadol master branch"
        {...(canCreateSettlement
          ? { actionLabel: 'Add settlement', actionIcon: <Plus size={16} />, onAction: () => navigate('/branches/settlement/new') }
          : {})}
      />

      <div className="acc-toolbar">
        <div className="acc-filters">
          {!isBranchWorkspace && (
            <label className="acc-filter-wide">
              <span>PAYING BRANCH</span>
              <div className="acc-payee-filter">
                <SearchableSelect
                  options={branchOptions}
                  value={fromBranchId}
                  onChange={(value) => applyFilter(() => setFromBranchId(value))}
                  placeholder="All paying branches"
                  disabled={loading}
                />
                {fromBranchId !== 'all' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyFilter(() => setFromBranchId('all'))}
                    aria-label="Clear branch filter"
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            </label>
          )}

          <label>
            <span>SETTLEMENT DATE</span>
            <NepaliDatePicker
              value={settlementDate}
              onChange={(value) => applyFilter(() => setSettlementDate(value))}
            />
          </label>
        </div>

        <label>
          <span>STATUS</span>
          <FormField
            label=""
            type="select"
            value={status}
            onChange={(value) => applyFilter(() => setStatus(value as BranchSettlementStatus | ''))}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'partially_paid', label: 'Partially paid' },
              { value: 'settled', label: 'Settled' },
            ]}
          />
        </label>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <Table
        selectable={false}
        loading={loadingRows}
        loadingMessage="Loading settlements…"
        data={rows}
        columns={[
          { header: 'SN', accessor: 'sn', width: '60px' },
          {
            header: 'Statement ID',
            width: '185px',
            accessor: (item) => (
              <button
                type="button"
                className="acc-link acc-entry-no"
                onClick={() => navigate(`/branches/settlement/${item.id}`)}
              >
                {item.statementNo}
              </button>
            ),
          },
          { header: 'Branch', width: '210px', accessor: (item) => `${item.fromBranch} → ${item.toBranch}` },
          {
            header: 'Net payable',
            width: '130px',
            className: 'acc-num',
            accessor: (item) => <span className="acc-num">{money(item.netPayable)}</span>,
          },
          {
            header: 'Paid / balance',
            width: '160px',
            accessor: (item) => (
              <>
                <span className="acc-stack">Paid {money(item.paidAmount)}</span>
                <span className="acc-stack">
                  {item.remainingAmount > 0 ? `Due ${money(item.remainingAmount)}` : 'Cleared'}
                </span>
              </>
            ),
          },
          {
            header: 'Payment',
            width: '185px',
            accessor: (item) =>
              item.paymentBreakdown.length > 0 ? (
                <>
                  {item.paymentBreakdown.map((line) => (
                    <span key={line.method} className="acc-stack">
                      {line.method} - {money(line.amount)}
                    </span>
                  ))}
                </>
              ) : (
                <span className="acc-muted">Not paid</span>
              ),
          },
          {
            header: 'Status',
            width: '150px',
            accessor: (item) => (
              <>
                <StatusChip variant="solid" tone={settlementStatusTone(item.status)}>
                  {settlementStatusLabel(item.status)}
                </StatusChip>
                {item.status === 'partially_paid' && (
                  <span className="acc-sub">
                    {money(item.paidAmount)} of {money(item.netPayable)}
                  </span>
                )}
              </>
            ),
          },
          {
            header: 'Settlement date',
            width: '125px',
            accessor: (item) => toBsDate(item.settlementDate) || item.settlementDate,
          },
        ]}
        minWidth="1250px"
        emptyMessage={
          fromBranchId !== 'all'
            ? 'No settlements recorded for that branch yet.'
            : 'No branch settlements recorded yet.'
        }
      />

      <Pagination
        ariaLabel="Branch settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => applyFilter(() => setPageSize(size))}
        summary={`${total} settlement${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default BranchSettlement;
