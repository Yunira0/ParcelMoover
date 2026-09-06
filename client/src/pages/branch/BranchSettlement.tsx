import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import SearchableSelect, { type SearchableSelectOption } from '../../components/SearchableSelect';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import { Banner } from '../accounting/ui';
import { useBranchScope } from '../../context/BranchScopeContext';
import { useBranchAccess } from '../../hooks/useBranchAccess';
import { getBranchSettlements } from '../../services/branchTracking.service';
import '../../components/merchant/MerchantFilterBar.css';
import '../../components/branch/BranchOverviewFilterBar.css';
import '../vendor/VendorFinance.css';

const PAGE_SIZE = 20;

interface BranchSettlementRow {
  id: string;
  sn: number;
  statementId: string;
  route: string;
  amount: string;
  settlementDate: string;
  payment: string;
  remark: string;
}

const BranchSettlement: React.FC = () => {
  const navigate = useNavigate();
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, loading } = useBranchScope();
  const { canWriteOtherBranches } = useBranchAccess();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<BranchSettlementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');

  const options = (allLabel: string): SearchableSelectOption[] => [
    { id: 'all', label: allLabel },
    ...branches.map((b) => ({ id: b.id, label: b.name, description: b.district ?? undefined })),
  ];

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading
    setLoadingRows(true);
    getBranchSettlements({
      ...(fromBranchId !== 'all' ? { fromBranchId } : {}),
      ...(toBranchId !== 'all' ? { toBranchId } : {}),
      ...(fromDate ? { dateFrom: fromDate } : {}),
      ...(toDate ? { dateTo: toDate } : {}),
      page,
      pageSize: pageSizeChoice,
    }, controller.signal).then((response) => {
      setRows(response.data.map((item, index) => ({
        id: item.id,
        sn: (response.meta.page - 1) * response.meta.pageSize + index + 1,
        statementId: item.statementNo,
        route: `${item.fromBranch} → ${item.toBranch}`,
        amount: `Rs. ${item.netPayable.toLocaleString()}`,
        settlementDate: item.settlementDate,
        payment: item.paymentMethod || item.status,
        remark: item.remark || `${item.orderCount} order${item.orderCount === 1 ? '' : 's'}`,
      })));
      setTotal(response.meta.total);
      setTotalPages(response.meta.totalPages);
      setError('');
    }).catch(() => setError('Failed to load branch settlements.')).finally(() => setLoadingRows(false));
    return () => controller.abort();
  }, [fromBranchId, toBranchId, fromDate, toDate, page, pageSizeChoice]);

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof BranchSettlementRow, width: '60px' },
    { header: 'Statement ID', accessor: 'statementId' as keyof BranchSettlementRow, width: '180px' },
    { header: 'Route', accessor: 'route' as keyof BranchSettlementRow, width: '220px' },
    { header: 'Amount', accessor: 'amount' as keyof BranchSettlementRow, width: '130px' },
    { header: 'Settlement date', accessor: 'settlementDate' as keyof BranchSettlementRow, width: '130px' },
    { header: 'Payment', accessor: 'payment' as keyof BranchSettlementRow, width: '180px' },
    { header: 'Remark', accessor: 'remark' as keyof BranchSettlementRow, width: '180px' },
  ];

  return (
    <div className="vendor-finance-page">
      <PageHeader
        title="Branch Settlement"
        subtitle="COD statements settled between branches"
        actionLabel="Add settlement"
        actionIcon={<Plus size={16} />}
        actionDisabled={!canWriteOtherBranches}
        onAction={() => navigate('/branches/settlement/new')}
      />

      {!canWriteOtherBranches && (
        <Banner tone="info">
          You have read-only access to other branches. Recording a settlement stays with your own
          branch and the super admin.
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      <div className="vendor-finance-toolbar">
        <div className="vendor-finance-date-range">
          <label className="branch-filter-narrow">
            From Branch
            <SearchableSelect
              options={options('All branches')}
              value={fromBranchId}
              onChange={(value) => { setFromBranchId(value); setPage(1); }}
              placeholder="All branches"
              disabled={loading}
            />
          </label>
          <label className="branch-filter-narrow">
            To Branch
            <SearchableSelect
              options={options('Any destination')}
              value={toBranchId}
              onChange={(value) => { setToBranchId(value); setPage(1); }}
              placeholder="Any destination"
              disabled={loading}
            />
          </label>
          <label className="merchant-filter-daterange">
            <span>Date</span>
            <div className="merchant-filter-range">
              <NepaliDatePicker
                value={fromDate}
                max={toDate || undefined}
                onChange={(next) => {
                  setPage(1);
                  setFromDate(next);
                }}
                placeholder="From"
                aria-label="Date range start"
              />
              <span className="merchant-filter-range-sep" aria-hidden="true">~</span>
              <NepaliDatePicker
                value={toDate}
                min={fromDate || undefined}
                onChange={(next) => {
                  setPage(1);
                  setToDate(next);
                }}
                placeholder="To"
                aria-label="Date range end"
              />
            </div>
          </label>
        </div>
      </div>

      <Table
        selectable={false}
        data={rows}
        columns={columns}
        loading={loadingRows}
        loadingMessage="Loading settlements…"
        minWidth="1190px"
        emptyMessage="No branch settlements recorded yet."
      />

      <Pagination
        ariaLabel="Branch settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSizeChoice}
        pageSizeLabel="settlements"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          setPage(1);
        }}
        summary={`${total} settlement${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default BranchSettlement;
