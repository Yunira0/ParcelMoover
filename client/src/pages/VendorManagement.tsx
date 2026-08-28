import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronDown, FolderOpen } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import { toBsDate } from '../utils/nepaliDate';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import ToggleSwitch from '../components/ToggleSwitch';
import Button from '../components/Button';
import UserDocumentsModal from '../components/UserDocumentsModal';
import KycManagement from './KycManagement';
import { getVendors, updateUserStatus } from '../services/users.service';
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

// The vendor's registered company - what identifies them everywhere on this
// page now, in place of the owner's personal client name. Falls back to the
// client name for the rare vendor registered before a company name was
// required.
const vendorDisplayName = (v: { company: string; client: string }): string => v.company || v.client;

const VendorManagement: React.FC = () => {
  const navigate = useNavigate();
  const isAdmin = isAdminSide();
  const isPureSales = isSalesUser();
  const currentUserId = getCurrentUser()?.id;
  const canManage = isAdmin || isPureSales;
  const canEdit = canManage;
  const canCreate = isAdminSide() || hasAnyRole(['sales']);
  // Registration documents are PII; the /uploads route only serves them to
  // super_admin/admin, so sales never sees the column.
  const canViewDocuments = isAdmin;
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
  const [documentsVendor, setDocumentsVendor] = useState<VendorUser | null>(null);
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // Rows with a status write in flight, so a row's own toggle disables without
  // freezing the rest of the table.
  const [statusSavingIds, setStatusSavingIds] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState('');

  // Optimistic: the switch moves immediately and rolls back if the write fails,
  // matching how Rider and Admin management handle the same toggle.
  const toggleVendorStatus = async (vendor: VendorUser) => {
    const nextStatus = vendor.status === 'active' ? 'inactive' : 'active';
    setStatusError('');
    setStatusSavingIds(prev => new Set(prev).add(vendor.id));
    setVendors(prev => prev.map(v => (v.id === vendor.id ? { ...v, status: nextStatus } : v)));
    try {
      await updateUserStatus('vendor', vendor.id, nextStatus);
    } catch (err) {
      console.error('Failed to update vendor status:', err);
      setVendors(prev => prev.map(v => (v.id === vendor.id ? { ...v, status: vendor.status } : v)));
      setStatusError(`Failed to set ${vendorDisplayName(vendor)} ${nextStatus}. Please try again.`);
    } finally {
      setStatusSavingIds(prev => {
        const next = new Set(prev);
        next.delete(vendor.id);
        return next;
      });
    }
  };

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
    // Vendor name leads - it's the company staff actually deal with day to
    // day. Owner name stays alongside it rather than folded into a subtext,
    // since it's still a real column vendors are searched and sorted by.
    { header: 'VENDOR NAME', accessor: (item: VendorUser) => vendorDisplayName(item) },
    { header: 'OWNER NAME', accessor: 'client' as keyof VendorUser },
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
      accessor: (item: VendorUser) => {
        // Admin-only, deliberately. updateManagedUser stamps sales_edited_at
        // whenever a pure-sales actor writes to a vendor, and refuses outright
        // once it is set - so giving sales this switch would either spend their
        // one-time vendor edit on a status flip or 403 after they'd already
        // used it. That budget is meant for changing a vendor's details.
        const canToggle = isAdmin;
        return (
          <div className="vendor-status-cell">
            {canToggle && (
              <ToggleSwitch
                checked={item.status === 'active'}
                disabled={statusSavingIds.has(item.id)}
                onChange={() => toggleVendorStatus(item)}
                ariaLabel={`Set ${vendorDisplayName(item)} ${item.status === 'active' ? 'inactive' : 'active'}`}
              />
            )}
            <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
              {item.status}
            </StatusChip>
          </div>
        );
      }
    },
    // The API sends these as AD "YYYY-MM-DD"; every date shown in this app is BS.
    { header: 'JOINED', accessor: (v: VendorUser) => toBsDate(v.joined) || '—' },
    { header: 'LAST ORDERED DATE', accessor: (v: VendorUser) => toBsDate(v.lastOrderedDate) || '—' },
    ...(canViewDocuments
      ? [{
          header: 'DOCUMENTS',
          accessor: (item: VendorUser) => (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDocumentsVendor(item)}
            >
              <FolderOpen size={14} />
              View
            </Button>
          ),
          width: '120px',
        }]
      : []),
    ...(canEdit
      ? [{
          header: 'ACTION',
          accessor: (item: VendorUser) => {
            const canEditRow =
              isAdmin || (isPureSales && item.salesUserId === currentUserId && !item.salesEditUsed);
            // A rep resets their own client's password when that client is locked
            // out - ownership only, not the one-time edit budget, which is about
            // changing the vendor's details rather than helping them back in.
            const canResetPassword =
              isAdmin || (isPureSales && item.salesUserId === currentUserId);
            return (
              <TableRowActions
                onEdit={canEditRow ? () => navigate(`/vendors/${item.id}/edit`) : undefined}
                onUpdatePassword={
                  canResetPassword
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
              placeholder="Search vendor name, owner name, phone, email..."
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
          {statusError && <p className="vendor-status-error">{statusError}</p>}
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

      <UserDocumentsModal
        isOpen={Boolean(documentsVendor)}
        userType="vendor"
        target={documentsVendor ? { id: documentsVendor.id, name: vendorDisplayName(documentsVendor) } : null}
        onClose={() => setDocumentsVendor(null)}
      />

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
