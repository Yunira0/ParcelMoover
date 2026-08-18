import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronDown } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import { toBsDate } from '../utils/nepaliDate';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import KycManagement from './KycManagement';
import { getVendors } from '../services/users.service';
import { isAdminSide, isSalesUser, hasAnyRole, getCurrentUser, hasAdminPermission } from '../utils/auth';
import './VendorManagement.css';

interface VendorUser {
  id: string;
  sn: number;
  client: string;
  company: string;
  email: string;
  phone: string;
  location: string;
  orders: {
    total: number;
    delivered: number;
    returned: number;
  };
  codDue: number;
  status: 'active' | 'inactive';
  joined: string;
  lastOrderedDate: string;
  salesUserId: string | null;
  salesEditUsed: boolean;
}

// Starting rows-per-page. The selector below the table can change it; the
// server caps any value at 100 (auth.controller LIST_MAX_PAGE_SIZE).
const PAGE_SIZE = 20;

const VendorManagement: React.FC = () => {
  const navigate = useNavigate();
  const isAdmin = isAdminSide();
  const isPureSales = isSalesUser();
  const currentUserId = getCurrentUser()?.id;
  const canManage = isAdmin || isPureSales;
  const canEdit = canManage;
  const canCreate = isAdminSide() || hasAnyRole(['sales']);
  // KYC is the application a vendor account starts life as, so it lives here
  // as a second view rather than as a section of its own. Sales never sees it.
  const canReviewKyc = hasAdminPermission('KYC_ACCESS');
  const [searchParams, setSearchParams] = useSearchParams();
  const view: 'vendors' | 'kyc' =
    canReviewKyc && searchParams.get('tab') === 'kyc' ? 'kyc' : 'vendors';
  const selectView = (next: 'vendors' | 'kyc') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'kyc') params.set('tab', 'kyc');
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  };
  const [filter, setFilter] = useState<'all' | 'high-volume' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [vendors, setVendors] = useState<VendorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeVendor, setActiveVendor] = useState<VendorUser | null>(null);
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page, pageSize: pageSizeChoice };
      if (searchQuery) params.search = searchQuery;
      if (activeStatus !== 'all') params.status = activeStatus;

      const res = await getVendors(params);
      if (res && res.success && Array.isArray(res.data)) {
        setVendors(res.data);
        if (res.meta) {
          setTotalPages(res.meta.totalPages);
          setTotal(res.meta.total);
        }
      } else {
        setVendors([]);
      }
    } catch (err) {
      console.error('Failed to load vendors:', err);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSizeChoice, searchQuery, activeStatus]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, activeStatus, filter]);

  // Client-side filter for tab (high-volume requires order count which comes from server)
  const displayVendors = filter === 'high-volume'
    ? vendors.filter(v => v.orders.total > 100)
    : vendors;

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof VendorUser, width: '50px' },
    { header: 'CLIENT', accessor: 'client' as keyof VendorUser },
    { header: 'COMPANY', accessor: 'company' as keyof VendorUser },
    { header: 'EMAIL', accessor: 'email' as keyof VendorUser },
    { header: 'PHONE', accessor: 'phone' as keyof VendorUser },
    { header: 'LOCATION', accessor: 'location' as keyof VendorUser },
    {
      header: 'ORDERS',
      accessor: (item: VendorUser) => (
        <div className="orders-info">
          <span>TOTAL ORDERS: {item.orders.total}</span>
          Delivered: {item.orders.delivered}<br />
          Returned: {item.orders.returned}
        </div>
      )
    },
    {
      header: 'COD DUE',
      accessor: (item: VendorUser) => `Rs. ${item.codDue}`
    },
    {
      header: 'STATUS',
      accessor: (item: VendorUser) => (
        <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
          {item.status}
        </StatusChip>
      )
    },
    // The API sends these as AD "YYYY-MM-DD"; every date shown in this app is BS.
    { header: 'JOINED', accessor: (v: VendorUser) => toBsDate(v.joined) || '—' },
    { header: 'LAST ORDERED DATE', accessor: (v: VendorUser) => toBsDate(v.lastOrderedDate) || '—' },
    ...(canEdit
      ? [{
          header: 'ACTION',
          accessor: (item: VendorUser) => {
            const canEditRow =
              isAdmin || (isPureSales && item.salesUserId === currentUserId && !item.salesEditUsed);
            return (
              <TableRowActions
                onEdit={canEditRow ? () => navigate(`/vendors/${item.id}/edit`) : undefined}
                onUpdatePassword={
                  isAdmin
                    ? () => {
                        setActiveVendor(item);
                        setActionMode('password');
                      }
                    : undefined
                }
              />
            );
          },
          width: '220px',
        }]
      : []),
  ];

  return (
    <div className="vendor-management-container">
      <PageHeader
        title="VENDOR MANAGEMENT"
        subtitle={
          view === 'kyc'
            ? 'Review and approve vendor onboarding applications.'
            : 'Oversee client accounts, delivery statistics, and financial tracking.'
        }
        actionLabel={canCreate && view === 'vendors' ? 'Add new' : undefined}
        actionIcon={canCreate && view === 'vendors' ? <Plus size={16} /> : undefined}
        onAction={canCreate && view === 'vendors' ? () => navigate('/vendors/new') : undefined}
      />

      {canReviewKyc && (
        <div className="vendor-views">
          <SegmentedTabs
            ariaLabel="Vendor management view"
            fullWidth={false}
            value={view}
            onChange={selectView}
            options={[
              { value: 'vendors', label: 'Vendors' },
              { value: 'kyc', label: 'KYC Applications' },
            ]}
          />
        </div>
      )}

      {view === 'kyc' ? (
        <KycManagement embedded />
      ) : (
      <>
      <div className="vendor-filters">
        <SegmentedTabs
          ariaLabel="Vendor filter"
          fullWidth={false}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'high-volume', label: 'High volume client' },
            { value: 'active', label: 'Active client' },
          ]}
        />

        <div className="search-and-dropdowns">
          <div className="search-box">
            <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
            <input
              type="text"
              placeholder="Search client, phone, email, company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="dropdown-filter">
            <select value={activeStatus} onChange={(e) => setActiveStatus(e.target.value)}>
              <option value="all">Active Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <ChevronDown size={12} style={{ color: 'var(--color-text-caption)', flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading vendors...</div>
      ) : (
        <>
          <Table columns={columns} data={displayVendors} selectable={false} />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Vendor management pagination"
            summary={`${total} vendor${total !== 1 ? 's' : ''} total`}
            pageSize={pageSizeChoice}
            pageSizeLabel="vendors"
            onPageSizeChange={(size) => {
              setPageSizeChoice(size);
              setPage(1);
            }}
          />
        </>
      )}

      <UserActionModal
        isOpen={Boolean(activeVendor)}
        mode={actionMode}
        userType="vendor"
        target={activeVendor}
        onClose={() => setActiveVendor(null)}
        onSuccess={loadVendors}
      />
      </>
      )}
    </div>
  );
};

export default VendorManagement;
