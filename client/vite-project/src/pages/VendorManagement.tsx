import React, { useState, useEffect } from 'react';
import { Plus, Search, ChevronDown } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import AddVendorModal from '../components/AddVendorModal';
import UserActionModal from '../components/UserActionModal';
import { getVendors } from '../services/users.service';
import './VendorManagement.css';

interface VendorUser {
  id: string;
  sn: number;
  client: string;
  company: string;
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
}

const VendorManagement: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'high-volume' | 'active' | 'cod-pending'>('all');
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
        // Mock data fallback if backend is empty
        const mockVendors: VendorUser[] = [
          {
            id: '1',
            sn: 1,
            client: 'John Doe',
            company: 'Tech Corp',
            phone: '9876543210',
            location: 'Kathmandu, Nepal',
            orders: { total: 150, delivered: 140, returned: 10 },
            codDue: 5000,
            status: 'active',
            joined: '2026-01-15',
            lastOrderedDate: '2026-06-01'
          },
          {
            id: '2',
            sn: 2,
            client: 'Jane Smith',
            company: 'Biz Inc',
            phone: '9800000000',
            location: 'Lalitpur, Nepal',
            orders: { total: 85, delivered: 80, returned: 5 },
            codDue: 0,
            status: 'active',
            joined: '2026-02-20',
            lastOrderedDate: '2026-05-30'
          }
        ];
        setVendors(mockVendors);
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
        <span className={`status-badge ${item.status}`}>
          {item.status}
        </span>
      )
    },
    { header: 'JOINED', accessor: 'joined' as keyof VendorUser },
    { header: 'LAST ORDERED DATE', accessor: 'lastOrderedDate' as keyof VendorUser },
    {
      header: 'ACTION',
      accessor: (item: VendorUser) => (
        <TableRowActions
          onEdit={() => {
            setActiveVendor(item);
            setActionMode('edit');
          }}
          onUpdatePassword={() => {
            setActiveVendor(item);
            setActionMode('password');
          }}
        />
      ),
      width: '220px',
    }
  ];

  // Dynamic filter options
  const companies = ['all', ...Array.from(new Set(vendors.map(v => v.company)))];
  const locations = ['all', ...Array.from(new Set(vendors.map(v => v.location)))];

  const filteredVendors = vendors.filter(vendor => {
    const matchesSearch = searchQuery === '' || 
      vendor.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.phone.includes(searchQuery) ||
      vendor.location.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = filter === 'all' || 
      (filter === 'active' && vendor.status === 'active') ||
      (filter === 'cod-pending' && vendor.codDue > 0) ||
      (filter === 'high-volume' && vendor.orders.total > 100);

    const matchesStatus = activeStatus === 'all' || vendor.status === activeStatus;
    const matchesCompany = companyFilter === 'all' || vendor.company === companyFilter;
    const matchesLocation = locationFilter === 'all' || vendor.location === locationFilter;
    
    return matchesSearch && matchesTab && matchesStatus && matchesCompany && matchesLocation;
  });

  return (
    <div className="vendor-management-container">
      <div className="vendor-header">
        <div className="header-info">
          <h1>VENDOR MANAGEMENT</h1>
          <p>Oversee client accounts, delivery statistics, and financial tracking.</p>
        </div>
        <button className="add-new-btn" onClick={() => setIsModalOpen(true)}>
          Add new
          <Plus size={16} />
        </button>
      </div>

      <div className="vendor-filters">
        <div className="filter-tabs">
          <button 
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button 
            className={`filter-tab ${filter === 'high-volume' ? 'active' : ''}`}
            onClick={() => setFilter('high-volume')}
          >
            High volume client
          </button>
          <button 
            className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
            onClick={() => setFilter('active')}
          >
            Active client
          </button>
          <button 
            className={`filter-tab ${filter === 'cod-pending' ? 'active' : ''}`}
            onClick={() => setFilter('cod-pending')}
          >
            Cod pending
          </button>
        </div>

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

      <AddVendorModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          loadVendors();
        }}
      />
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
