import React, { useState } from 'react';
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
import '../../components/branch/BranchOverviewFilterBar.css';
import './BranchOverview.css';

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

// COD statements settled between branches — same layout as Rider/Vendor COD.
// The list stays empty until a branch-settlement endpoint exists.
const BranchSettlement: React.FC = () => {
  const navigate = useNavigate();
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, loading } = useBranchScope();
  const { canWriteOtherBranches } = useBranchAccess();
  const [settlementDate, setSettlementDate] = useState('');
  const [page, setPage] = useState(1);

  const options = (allLabel: string): SearchableSelectOption[] => [
    { id: 'all', label: allLabel },
    ...branches.map((b) => ({ id: b.id, label: b.name, description: b.district ?? undefined })),
  ];

  const rows: BranchSettlementRow[] = []; // TODO(backend): branch settlement list

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
    <div className="order-management-container branch-overview-page">
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

      <div className="merchant-filter-toolbar">
        <div className="merchant-filter-group">
          <label className="merchant-filter-wide branch-filter-narrow">
            <span>From Branch</span>
            <SearchableSelect options={options('All branches')} value={fromBranchId}
              onChange={setFromBranchId} placeholder="All branches" disabled={loading} />
          </label>
          <label className="merchant-filter-wide branch-filter-narrow">
            <span>To Branch</span>
            <SearchableSelect options={options('Any destination')} value={toBranchId}
              onChange={setToBranchId} placeholder="Any destination" disabled={loading} />
          </label>
          <label className="merchant-filter-wide branch-filter-narrow">
            <span>Settlement Date</span>
            <NepaliDatePicker value={settlementDate} onChange={setSettlementDate} />
          </label>
        </div>
      </div>

      <Table
        selectable={false}
        data={rows}
        columns={columns}
        minWidth="1190px"
        emptyMessage="No branch settlements recorded yet."
      />

      <Pagination
        ariaLabel="Branch settlements pagination"
        page={page}
        totalPages={1}
        onPageChange={setPage}
        summary={`${rows.length} settlements`}
      />
    </div>
  );
};

export default BranchSettlement;
