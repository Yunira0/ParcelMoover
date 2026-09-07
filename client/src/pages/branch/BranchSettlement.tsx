import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import FormField from '../../components/FormField';
import SearchableSelect, { type SearchableSelectOption } from '../../components/SearchableSelect';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import { Banner } from '../accounting/ui';
import { useBranchScope } from '../../context/BranchScopeContext';
import { useBranchAccess } from '../../hooks/useBranchAccess';
import { getCurrentUserLocationId, isBranchWorkspaceUser } from '../../utils/auth';
import {
  getBranchSettlements,
  type BranchSettlement,
  type BranchSettlementStatus,
  type BranchSettlementSummary,
} from '../../services/branchTracking.service';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import { toBsDate } from '../../utils/nepaliDate';
import '../../components/merchant/MerchantFilterBar.css';
import '../../components/branch/BranchOverviewFilterBar.css';
import '../vendor/VendorFinance.css';
import './BranchSettlement.css';

const PAGE_SIZE = 20;
const money = (value: number) => `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const EMPTY_SUMMARY: BranchSettlementSummary = { grossCod: 0, commissionCredit: 0, netPayable: 0, paid: 0, outstanding: 0, pendingStatements: 0 };

const BranchSettlement: React.FC = () => {
  const navigate = useNavigate();
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, loading } = useBranchScope();
  const { canWriteOtherBranches } = useBranchAccess();
  const canCreateSettlement = !isBranchWorkspaceUser() && (canWriteOtherBranches || Boolean(getCurrentUserLocationId()));
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<BranchSettlementStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<BranchSettlement[]>([]);
  const [summary, setSummary] = useState<BranchSettlementSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');

  const options = (allLabel: string): SearchableSelectOption[] => [
    { id: 'all', label: allLabel },
    ...branches.map((branch) => ({ id: branch.id, label: branch.name, description: branch.district ?? undefined })),
  ];

  useEffect(() => {
    const controller = new AbortController();
    setLoadingRows(true);
    getBranchSettlements({
      ...(fromBranchId !== 'all' ? { fromBranchId } : {}),
      ...(toBranchId !== 'all' ? { toBranchId } : {}),
      ...(fromDate ? { dateFrom: fromDate } : {}),
      ...(toDate ? { dateTo: toDate } : {}),
      ...(status ? { status } : {}),
      page,
      pageSize: pageSizeChoice,
    }, controller.signal).then((response) => {
      setRows(response.data);
      setSummary(response.summary);
      setTotal(response.meta.total);
      setTotalPages(response.meta.totalPages);
      setError('');
    }).catch(() => setError('Failed to load branch settlements.')).finally(() => setLoadingRows(false));
    return () => controller.abort();
  }, [fromBranchId, toBranchId, fromDate, toDate, status, page, pageSizeChoice]);

  const columns = [
    { header: 'SN', accessor: (item: BranchSettlement) => (page - 1) * pageSizeChoice + rows.indexOf(item) + 1, width: '60px' },
    { header: 'Statement ID', width: '185px', accessor: (item: BranchSettlement) => <button type="button" className="branch-statement-link" onClick={() => navigate(`/branches/settlement/${item.id}`)}>{item.statementNo}</button> },
    { header: 'Payment direction', width: '220px', accessor: (item: BranchSettlement) => `${item.fromBranch} → ${item.toBranch}` },
    { header: 'Orders', width: '80px', accessor: (item: BranchSettlement) => item.orderCount.toLocaleString() },
    { header: 'COD & credit', width: '185px', accessor: (item: BranchSettlement) => <div className="branch-money-stack"><span>COD {money(item.grossCod)}</span><span>Commission credit {money(item.commissionAmount)}</span></div> },
    { header: 'Net payable', width: '135px', className: 'branch-money-cell', accessor: (item: BranchSettlement) => money(item.netPayable) },
    { header: 'Paid / balance', width: '160px', accessor: (item: BranchSettlement) => <div className="branch-money-stack"><span>Paid {money(item.paidAmount)}</span><span className={item.remainingAmount > 0 ? 'branch-balance-due' : 'branch-balance-clear'}>{item.remainingAmount > 0 ? `Due ${money(item.remainingAmount)}` : 'Cleared'}</span></div> },
    { header: 'Payment', width: '170px', accessor: (item: BranchSettlement) => item.paymentBreakdown.length ? <div className="branch-money-stack">{item.paymentBreakdown.map((line) => <span key={line.method}>{line.method} · {money(line.amount)}</span>)}</div> : item.paidAmount > 0 ? <span className="branch-muted">{money(item.paidAmount)} recorded</span> : <span className="branch-muted">Not paid</span> },
    { header: 'Status', width: '150px', accessor: (item: BranchSettlement) => <><StatusChip variant="solid" tone={settlementStatusTone(item.status)}>{settlementStatusLabel(item.status)}</StatusChip>{item.status === 'partially_paid' && <div className="vendor-settlement-status-sub">{money(item.paidAmount)} of {money(item.netPayable)} received</div>}</> },
    { header: 'Statement date', width: '125px', accessor: (item: BranchSettlement) => toBsDate(item.settlementDate) || item.settlementDate },
  ];

  return (
    <div className="vendor-finance-page branch-settlement-page">
      <PageHeader title="Branch Statements" subtitle="COD owed by a collecting branch to the master branch, cleared after payment verification." {...(canCreateSettlement ? { actionLabel: 'Add statement', actionIcon: <Plus size={16} />, onAction: () => navigate('/branches/settlement/new') } : {})} />
      {error && <Banner tone="danger">{error}</Banner>}

      <section className="branch-ledger-strip" aria-label="Branch settlement position">
        <div><span>COD in statements</span><strong>{money(summary.grossCod)}</strong></div>
        <div><span>Commission credit</span><strong>{money(summary.commissionCredit)}</strong></div>
        <div><span>Net payable</span><strong>{money(summary.netPayable)}</strong></div>
        <div><span>Paid</span><strong>{money(summary.paid)}</strong></div>
        <div><span>Outstanding</span><strong className={summary.outstanding > 0 ? 'branch-balance-due' : 'branch-balance-clear'}>{money(summary.outstanding)}</strong><small>{summary.pendingStatements} open statement{summary.pendingStatements === 1 ? '' : 's'}</small></div>
      </section>

      <div className="vendor-finance-toolbar"><div className="vendor-finance-date-range">
        <label className="branch-filter-narrow">Paying Branch<SearchableSelect options={options('All paying branches')} value={fromBranchId} onChange={(value) => { setFromBranchId(value); setPage(1); }} placeholder="All paying branches" disabled={loading} /></label>
        <label className="branch-filter-narrow">Master Branch<SearchableSelect options={options('Any master branch')} value={toBranchId} onChange={(value) => { setToBranchId(value); setPage(1); }} placeholder="Any master branch" disabled={loading} /></label>
        <label className="branch-filter-narrow">Status<FormField label="" type="select" value={status} onChange={(value) => { setStatus(value as BranchSettlementStatus | ''); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'pending', label: 'Pending' }, { value: 'partially_paid', label: 'Partially paid' }, { value: 'settled', label: 'Settled' }]} /></label>
        <label className="merchant-filter-daterange"><span>Date</span><div className="merchant-filter-range"><NepaliDatePicker value={fromDate} max={toDate || undefined} onChange={(next) => { setPage(1); setFromDate(next); }} placeholder="From" aria-label="Date range start" /><span className="merchant-filter-range-sep" aria-hidden="true">~</span><NepaliDatePicker value={toDate} min={fromDate || undefined} onChange={(next) => { setPage(1); setToDate(next); }} placeholder="To" aria-label="Date range end" /></div></label>
      </div></div>

      <Table selectable={false} data={rows} columns={columns} loading={loadingRows} loadingMessage="Loading settlements…" minWidth="1600px" emptyMessage="No branch settlements recorded yet." />
      <Pagination ariaLabel="Branch settlements pagination" page={page} totalPages={totalPages} onPageChange={setPage} pageSize={pageSizeChoice} pageSizeLabel="settlements" onPageSizeChange={(size) => { setPageSizeChoice(size); setPage(1); }} summary={`${total} settlement${total === 1 ? '' : 's'}`} />
    </div>
  );
};

export default BranchSettlement;
