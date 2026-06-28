import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import { getRiders } from '../services/users.service';
import './RiderManagement.css';

interface RiderUser {
  id: string;
  sn: number;
  name: string;
  phone: string;
  location: string;
  orders: {
    total: number;
    delivered: number;
    returned: number;
  };
  payment: string;
  status: 'active' | 'inactive';
  joined: string;
}

const RiderManagement: React.FC = () => {
  const navigate = useNavigate();
  const [riders, setRiders] = useState<RiderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeRider, setActiveRider] = useState<RiderUser | null>(null);

  const loadRiders = async () => {
    try {
      setLoading(true);
      const res = await getRiders();
      if (res && res.success && Array.isArray(res.data)) {
        setRiders(res.data);
      } else if (Array.isArray(res)) {
        setRiders(res);
      } else {
        // Mock data based on Figma design (fallback if needed)
        const mockRiders: RiderUser[] = [
          {
            id: '1',
            sn: 1,
            name: 'Rider One',
            phone: '9800000001',
            location: 'Kathmandu, Nepal',
            orders: { total: 2, delivered: 1, returned: 0 },
            payment: 'COD',
            status: 'active',
            joined: '2026-05-01'
          }
        ];
        if (riders.length === 0) setRiders(mockRiders);
      }
    } catch (err) {
      console.error('Failed to load riders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRiders();
  }, []);

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof RiderUser, width: '34px' },
    { header: 'NAME', accessor: 'name' as keyof RiderUser, width: '100px' },
    { header: 'PHONE', accessor: 'phone' as keyof RiderUser, width: '124px' },
    { header: 'LOCATION', accessor: 'location' as keyof RiderUser },
    {
      header: 'PARCELS',
      accessor: (item: RiderUser) => (
        <div className="rider-orders-info">
          <span>TOTAL ORDERS: {item.orders.total}</span>
          Delivered: {item.orders.delivered}<br />
          Returned: {item.orders.returned}
        </div>
      ),
      width: '150px'
    },
    { header: 'PAYMENT', accessor: 'payment' as keyof RiderUser, width: '80px' },
    { 
      header: 'STATUS', 
      accessor: (item: RiderUser) => (
        <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
          {item.status}
        </StatusChip>
      ),
      width: '113px'
    },
    { header: 'JOINED', accessor: 'joined' as keyof RiderUser, width: '113px' },
    {
      header: 'ACTION',
      accessor: (item: RiderUser) => (
        <TableRowActions
          onEdit={() => {
            setActiveRider(item);
            setActionMode('edit');
          }}
          onUpdatePassword={() => {
            setActiveRider(item);
            setActionMode('password');
          }}
        />
      ),
      width: '220px'
    }
  ];

  const filteredRiders = riders.filter(rider => {
    const matchesSearch = searchQuery === '' || 
      (rider.name && rider.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (rider.phone && rider.phone.includes(searchQuery));
    
    const matchesFilter = filter === 'all' || (filter === 'active' && rider.status === 'active');
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="rider-management-container">
      <PageHeader
        title="RIDER MANAGEMENT"
        subtitle="Manage rider accounts, monitor delivery metrics"
        actionLabel="Add new"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate('/riders/new')}
      />

      <div className="rider-filters">
        <SegmentedTabs
          ariaLabel="Rider status filter"
          fullWidth={false}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'ACTIVE' },
          ]}
        />

        <div className="search-box">
          <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
          <input 
            type="text" 
            placeholder="Search name, phone, email" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loading && riders.length === 0 ? (
        <div className="loading-state">Loading riders...</div>
      ) : (
        <Table columns={columns} data={filteredRiders} selectable={false} />
      )}

      <UserActionModal
        isOpen={Boolean(activeRider)}
        mode={actionMode}
        userType="rider"
        target={activeRider}
        onClose={() => setActiveRider(null)}
        onSuccess={loadRiders}
      />
    </div>
  );
};

export default RiderManagement;
