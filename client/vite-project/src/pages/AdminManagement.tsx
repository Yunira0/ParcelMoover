import React, { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import AddAdminModal from '../components/AddAdminModal';
import UserActionModal from '../components/UserActionModal';
import { getAdmins } from '../services/users.service';
import './AdminManagement.css';

interface AdminUser {
  id: string;
  sn: number;
  name: string;
  phone: string;
  location: string;
  position: string;
  joined: string;
  status: 'active' | 'inactive';
}

const AdminManagement: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeAdmin, setActiveAdmin] = useState<AdminUser | null>(null);

  const loadAdmins = async () => {
    try {
      setLoading(true);
      const res = await getAdmins();
      if (res && res.success && Array.isArray(res.data)) {
        setAdmins(res.data);
      } else if (Array.isArray(res)) {
        setAdmins(res);
      }
    } catch (err) {
      console.error('Failed to load admins:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof AdminUser, width: '50px' },
    { header: 'NAME', accessor: 'name' as keyof AdminUser },
    { header: 'PHONE', accessor: 'phone' as keyof AdminUser },
    { header: 'LOCATION', accessor: 'location' as keyof AdminUser },
    { header: 'POSITION', accessor: 'position' as keyof AdminUser },
    { header: 'JOINED', accessor: 'joined' as keyof AdminUser },
    { 
      header: 'STATUS', 
      accessor: (item: AdminUser) => (
        <span className={`status-badge ${item.status}`}>
          {item.status}
        </span>
      )
    },
    {
      header: 'ACTION',
      accessor: (item: AdminUser) => (
        <TableRowActions
          onEdit={() => {
            setActiveAdmin(item);
            setActionMode('edit');
          }}
          onUpdatePassword={() => {
            setActiveAdmin(item);
            setActionMode('password');
          }}
        />
      ),
      width: '220px',
    }
  ];

  const filteredAdmins = admins.filter(admin => {
    const matchesFilter = filter === 'all' || admin.status === 'active';
    const matchesSearch = searchQuery === '' || 
      (admin.name && admin.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (admin.phone && admin.phone.includes(searchQuery)) ||
      (admin.position && admin.position.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (admin.location && admin.location.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="admin-management-container">
      <div className="admin-header">
        <div className="header-info">
          <h1>ADMIN MANAGEMENT</h1>
          <p>Oversee admin accounts and track performance metrics.</p>
        </div>
        <button className="add-new-btn" onClick={() => setIsModalOpen(true)}>
          Add new
          <Plus size={16} />
        </button>
      </div>

      <div className="admin-filters">
        <div className="filter-tabs">
          <button 
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button 
            className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
            onClick={() => setFilter('active')}
          >
            ACTIVE
          </button>
        </div>
      </div>

      <div className="admin-search">
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

      {loading ? (
        <div className="loading-state">Loading admins...</div>
      ) : (
        <Table columns={columns} data={filteredAdmins} selectable={false} />
      )}

      <AddAdminModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          loadAdmins();
        }}
      />
      <UserActionModal
        isOpen={Boolean(activeAdmin)}
        mode={actionMode}
        userType="admin"
        target={activeAdmin}
        onClose={() => setActiveAdmin(null)}
        onSuccess={loadAdmins}
      />
    </div>
  );
};

export default AdminManagement;
