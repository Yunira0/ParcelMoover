import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronDown } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import { getVendors } from '../services/users.service';
import { isAdminSide, isSalesUser, hasAnyRole, getCurrentUser } from '../utils/auth';
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
  const canCreate = isAdminSide() || hasAnyRole(['sales']);
  const [filter, setFilter] = useState<'all' | 'high-volume' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [vendors, setVendors] = useState<VendorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeVendor, setActiveVendor] = useState<VendorUser | null>(null);

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
    { header: 'JOINED', accessor: 'joined' as keyof VendorUser },
    { header: 'LAST ORDERED DATE', accessor: 'lastOrderedDate' as keyof VendorUser },
    ...(canManage
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
        subtitle="Oversee client accounts, delivery statistics, and financial tracking."
        actionLabel={canCreate ? 'Add new' : undefined}
        actionIcon={canCreate ? <Plus size={16} /> : undefined}
        onAction={canCreate ? () => navigate('/vendors/new') : undefined}
      />

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
    </div>
  );
};

export default VendorManagement;
