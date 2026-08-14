import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronDown } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import { toBsDate } from '../utils/nepaliDate';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import ToggleSwitch from '../components/ToggleSwitch';
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

const VendorManagement: React.FC = () => {
  const navigate = useNavigate();
  // Admins can edit any vendor and reset passwords. Sales can onboard new
  // clients (auto-linked to them) and gets exactly one self-service edit on
  // a vendor assigned to them - see canEditRow below for the per-row check.
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
  const [companyFilter, setCompanyFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [vendors, setVendors] = useState<VendorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeVendor, setActiveVendor] = useState<VendorUser | null>(null);
  const [statusSavingIds, setStatusSavingIds] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState('');

  const loadVendors = async () => {
    try {
      setLoading(true);
      const res = await getVendors();
      if (res && res.success && Array.isArray(res.data)) {
        setVendors(res.data);
      } else if (Array.isArray(res)) {
        setVendors(res);
      } else {
        console.error('Unexpected vendors response shape:', res);
        setVendors([]);
      }
    } catch (err) {
      console.error('Failed to load vendors:', err);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  // Optimistic toggle: flip the row immediately, revert if the server rejects it.
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
      setStatusError(`Failed to set ${vendor.client} ${nextStatus}. Please try again.`);
    } finally {
      setStatusSavingIds(prev => {
        const next = new Set(prev);
        next.delete(vendor.id);
        return next;
      });
    }
  };

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
        <div className="vendor-status-cell">
          <ToggleSwitch
            checked={item.status === 'active'}
            disabled={statusSavingIds.has(item.id)}
            onChange={() => toggleVendorStatus(item)}
            ariaLabel={`Set ${item.client} ${item.status === 'active' ? 'inactive' : 'active'}`}
          />
          <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
            {item.status}
          </StatusChip>
        </div>
      ),
      width: '150px',
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

  // Dynamic filter options
  const companies = ['all', ...Array.from(new Set(vendors.map(v => v.company)))];
  const locations = ['all', ...Array.from(new Set(vendors.map(v => v.location)))];

  const filteredVendors = vendors.filter(vendor => {
    const matchesSearch = searchQuery === '' || 
      vendor.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.phone.includes(searchQuery) ||
      vendor.location.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = filter === 'all' || 
      (filter === 'active' && vendor.status === 'active') ||
      (filter === 'high-volume' && vendor.orders.total > 100);

    const matchesStatus = activeStatus === 'all' || vendor.status === activeStatus;
    const matchesCompany = companyFilter === 'all' || vendor.company === companyFilter;
    const matchesLocation = locationFilter === 'all' || vendor.location === locationFilter;
    
    return matchesSearch && matchesTab && matchesStatus && matchesCompany && matchesLocation;
  });

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

          <div className="dropdown-filter">
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
              <option value="all">Company</option>
              {companies.filter(c => c !== 'all').map(company => (
                <option key={company} value={company}>{company}</option>
              ))}
            </select>
            <ChevronDown size={12} style={{ color: 'var(--color-text-caption)', flexShrink: 0 }} />
          </div>

          <div className="dropdown-filter">
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="all">Location</option>
              {locations.filter(l => l !== 'all').map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            <ChevronDown size={12} style={{ color: 'var(--color-text-caption)', flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {statusError && <p className="vendor-status-error">{statusError}</p>}

      {loading ? (
        <div className="loading-state">Loading vendors...</div>
      ) : (
        <Table columns={columns} data={filteredVendors} selectable={false} />
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
