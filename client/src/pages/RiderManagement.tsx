import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import ToggleSwitch from '../components/ToggleSwitch';
import { getRiders, updateUserStatus } from '../services/users.service';
import './RiderManagement.css';

interface RiderUser {
  id: string;
  sn: number;
  name: string;
  email: string;
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

const PAGE_SIZE = 20;

const RiderManagement: React.FC = () => {
  const navigate = useNavigate();
  const [riders, setRiders] = useState<RiderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeRider, setActiveRider] = useState<RiderUser | null>(null);
  const [statusSavingIds, setStatusSavingIds] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadRiders = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
      if (searchQuery) params.search = searchQuery;
      if (filter !== 'all') params.status = filter;

      const res = await getRiders(params);
      if (res && res.success && Array.isArray(res.data)) {
        setRiders(res.data);
        if (res.meta) {
          setTotalPages(res.meta.totalPages);
          setTotal(res.meta.total);
        }
      } else {
        setRiders([]);
      }
    } catch (err) {
      console.error('Failed to load riders:', err);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filter]);

  useEffect(() => {
    loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, filter]);

  const toggleRiderStatus = async (rider: RiderUser) => {
    const nextStatus = rider.status === 'active' ? 'inactive' : 'active';
    setStatusError('');
    setStatusSavingIds(prev => new Set(prev).add(rider.id));
    setRiders(prev => prev.map(r => (r.id === rider.id ? { ...r, status: nextStatus } : r)));
    try {
      await updateUserStatus('rider', rider.id, nextStatus);
    } catch (err) {
      console.error('Failed to update rider status:', err);
      setRiders(prev => prev.map(r => (r.id === rider.id ? { ...r, status: rider.status } : r)));
      setStatusError(`Failed to set ${rider.name} ${nextStatus}. Please try again.`);
    } finally {
      setStatusSavingIds(prev => {
        const next = new Set(prev);
        next.delete(rider.id);
        return next;
      });
    }
  };

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof RiderUser, width: '34px' },
    { header: 'NAME', accessor: 'name' as keyof RiderUser, width: '100px' },
    { header: 'EMAIL', accessor: 'email' as keyof RiderUser, width: '160px' },
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
        <div className="rider-status-cell">
          <ToggleSwitch
            checked={item.status === 'active'}
            disabled={statusSavingIds.has(item.id)}
            onChange={() => toggleRiderStatus(item)}
            ariaLabel={`Set ${item.name} ${item.status === 'active' ? 'inactive' : 'active'}`}
          />
          <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
            {item.status}
          </StatusChip>
        </div>
      ),
      width: '150px'
    },
    { header: 'JOINED', accessor: 'joined' as keyof RiderUser, width: '113px' },
    {
      header: 'ACTION',
      accessor: (item: RiderUser) => (
        <TableRowActions
          onEdit={() => navigate(`/riders/${item.id}/edit`)}
          onUpdatePassword={() => {
            setActiveRider(item);
            setActionMode('password');
          }}
        />
      ),
      width: '220px'
    }
  ];

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

      {statusError && <p className="rider-status-error">{statusError}</p>}

      {loading ? (
        <div className="loading-state">Loading riders...</div>
      ) : (
        <>
          <Table columns={columns} data={riders} selectable={false} />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Rider management pagination"
            summary={`${total} rider${total !== 1 ? 's' : ''} total`}
            pageSize={PAGE_SIZE}
          />
        </>
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
