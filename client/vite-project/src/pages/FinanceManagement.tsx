import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import Table from '../components/Table';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import AddSettlementModal from '../components/AddSettlementModal';
import './FinanceManagement.css';

type FinanceType = 'rider' | 'vendor';
type SettlementStatus = 'pending' | 'settled' | 'review';

interface FinanceSettlement {
  id: string;
  sn: number;
  statementId: string;
  name: string;
  amount: number;
  settlementDate: string;
  remark: string;
  status: SettlementStatus;
  type: FinanceType;
  phone: string;
  email: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
}

const SETTLEMENTS: FinanceSettlement[] = [
  {
    id: 'rider-1',
    sn: 1,
    statementId: 'STM-R-2026-001',
    name: 'Rider One',
    amount: 18400,
    settlementDate: '2026-06-18',
    remark: 'Kathmandu COD batch',
    status: 'pending',
    type: 'rider',
    phone: '9800000001',
    email: 'rider.one@parcelmoover.com',
    bankName: 'Nabil Bank',
    bankAccountNo: '1234567890',
    bankAccountHolder: 'Rider One',
  },
  {
    id: 'rider-2',
    sn: 2,
    statementId: 'STM-R-2026-002',
    name: 'Rider Two',
    amount: 12650,
    settlementDate: '2026-06-17',
    remark: 'Lalitpur deliveries',
    status: 'settled',
    type: 'rider',
    phone: '9800000002',
    email: 'rider.two@parcelmoover.com',
    bankName: 'Nepal Investment Bank',
    bankAccountNo: '9876543210',
    bankAccountHolder: 'Rider Two',
  },
  {
    id: 'rider-3',
    sn: 3,
    statementId: 'STM-R-2026-003',
    name: 'Rider Three',
    amount: 9800,
    settlementDate: '2026-06-16',
    remark: 'Pending receipt review',
    status: 'review',
    type: 'rider',
    phone: '9800000003',
    email: 'rider.three@parcelmoover.com',
    bankName: 'Prabhu Bank',
    bankAccountNo: '5555666677',
    bankAccountHolder: 'Rider Three',
  },
  {
    id: 'vendor-1',
    sn: 1,
    statementId: 'STM-V-2026-001',
    name: 'Tech Corp',
    amount: 42000,
    settlementDate: '2026-06-18',
    remark: 'Weekly vendor payable',
    status: 'pending',
    type: 'vendor',
    phone: '9876543210',
    email: 'finance@techcorp.com',
    bankName: 'Nabil Bank',
    bankAccountNo: '1234567890123',
    bankAccountHolder: 'Tech Corp Pvt Ltd',
  },
  {
    id: 'vendor-2',
    sn: 2,
    statementId: 'STM-V-2026-002',
    name: 'Biz Inc',
    amount: 31500,
    settlementDate: '2026-06-15',
    remark: 'COD reconciliation complete',
    status: 'settled',
    type: 'vendor',
    phone: '9800000000',
    email: 'accounts@bizinc.com',
    bankName: 'Himalayan Bank',
    bankAccountNo: '9876543210987',
    bankAccountHolder: 'Biz Inc Trading',
  },
];

const statusLabels: Record<SettlementStatus, string> = {
  pending: 'Pending',
  settled: 'Settled',
  review: 'Review',
};

const statusTones: Record<SettlementStatus, StatusChipTone> = {
  pending: 'warning',
  settled: 'success',
  review: 'info',
};

const FinanceManagement: React.FC = () => {
  const [activeType, setActiveType] = useState<FinanceType>('rider');
  const [searchQuery, setSearchQuery] = useState('');
  const [settlements, setSettlements] = useState<FinanceSettlement[]>(SETTLEMENTS);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return settlements
      .filter(item => item.type === activeType)
      .filter(item => {
        if (!q) return true;
        return (
          item.statementId.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.phone.includes(q) ||
          item.email.toLowerCase().includes(q) ||
          item.remark.toLowerCase().includes(q)
        );
      })
      .map((item, index) => ({ ...item, sn: index + 1 }));
  }, [activeType, searchQuery, settlements]);

  // The modal doesn't collect bank details, so default them when adding to the list.
  const handleAddSettlement = (
    newSettlement: Omit<FinanceSettlement, 'bankName' | 'bankAccountNo' | 'bankAccountHolder'>,
  ) => {
    setSettlements(prev => [
      { ...newSettlement, bankName: '', bankAccountNo: '', bankAccountHolder: '' },
      ...prev,
    ]);
  };

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof FinanceSettlement, width: '50px' },
    { header: 'STATEMENT ID', accessor: 'statementId' as keyof FinanceSettlement },
    { header: 'NAME', accessor: 'name' as keyof FinanceSettlement },
    {
      header: 'AMOUNT',
      accessor: (item: FinanceSettlement) => `Rs. ${item.amount.toLocaleString()}`,
    },
    { header: 'SETTLEMENT DATE', accessor: 'settlementDate' as keyof FinanceSettlement },
    ...(activeType === 'vendor'
      ? [
          {
            header: 'BANK DETAILS',
            accessor: (item: FinanceSettlement) => (
              <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--color-text-caption)' }}>
                <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>Bank:</span> {item.bankName}</div>
                <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>A/C:</span> {item.bankAccountNo}</div>
                <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>Name:</span> {item.bankAccountHolder}</div>
              </div>
            ),
          },
        ]
      : []),
    { header: 'REMARK', accessor: 'remark' as keyof FinanceSettlement },
    {
      header: 'STATUS',
      accessor: (item: FinanceSettlement) => (
        <StatusChip variant="solid" tone={statusTones[item.status]}>
          {statusLabels[item.status]}
        </StatusChip>
      ),
    },
  ];

  return (
    <div className="finance-management-container">
      <PageHeader
        title="COD MANAGEMENT"
        subtitle="Manage financial accounts and monitor performance indicators."
        actionLabel="Add Settlement"
        actionIcon={<Plus size={16} />}
        onAction={() => setIsModalOpen(true)}
      />

      <div className="finance-filters">
        <SegmentedTabs
          ariaLabel="Finance account type"
          fullWidth={false}
          value={activeType}
          onChange={setActiveType}
          options={[
            { value: 'rider', label: 'RIDER' },
            { value: 'vendor', label: 'VENDOR' },
          ]}
        />

        <div className="search-box">
          <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
          <input
            type="text"
            placeholder="Search name, phone, email"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="loading-state">No finance records found.</div>
      ) : (
        <Table columns={columns} data={rows} selectable={false} />
      )}

      <AddSettlementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleAddSettlement}
        defaultType={activeType}
        existingCount={settlements.filter(s => s.type === activeType).length}
      />
    </div>
  );
};

export default FinanceManagement;
