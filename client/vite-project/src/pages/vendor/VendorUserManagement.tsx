import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Mail,
  MessageSquare,
  Package,
  Pencil,
  Search,
  Ticket,
  Truck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Button from '../../components/Button';
import {
  getStaff,
  PERMISSION_LABELS,
  setStaffEnabled,
  type Staff,
  type StaffPermission,
} from '../../services/staff.service';
import './VendorUserManagement.css';

const PERMISSION_ICONS: Record<StaffPermission, LucideIcon> = {
  DASHBOARD_ACCESS: LayoutDashboard,
  ORDER_ACCESS: Package,
  FINANCE_ACCESS: Wallet,
  USER_ACCESS: Users,
  TICKETS_ACCESS: Ticket,
  REMARKS_ACCESS: MessageSquare,
  DELIVERY_CHARGES_ACCESS: Truck,
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'S';

const VendorUserManagement: React.FC = () => {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStaff(await getStaff());
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const visibleStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [staff, searchQuery]);

  const openCreate = () => navigate('/user-management/staff/new');
  const openEdit = (member: Staff) =>
    navigate(`/user-management/staff/${member.id}/edit`, { state: { staff: member } });

  const toggleEnabled = async (member: Staff) => {
    setTogglingId(member.id);
    try {
      await setStaffEnabled(member.id, !member.enabled);
      await loadStaff();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update staff status.');
    } finally {
      setTogglingId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (member: Staff) => visibleStaff.findIndex((s) => s.id === member.id) + 1,
        width: '50px',
      },
      {
        header: 'STAFF NAME',
        accessor: (member: Staff) => (
          <div className="staff-name-cell">
            <span className="staff-avatar">{initials(member.name)}</span>
            <span className="staff-name">{member.name}</span>
          </div>
        ),
        width: '220px',
      },
      {
        header: 'EMAIL',
        accessor: (member: Staff) => (
          <span className="staff-email-cell">
            <Mail size={14} />
            {member.email}
          </span>
        ),
        width: '230px',
      },
      {
        header: 'PERMISSIONS',
        accessor: (member: Staff) => (
          <div className="staff-permission-chips">
            {member.permissions.map((permission) => {
              // Guard against legacy/unknown permission strings stored before the set changed.
              const Icon = PERMISSION_ICONS[permission];
              const label = PERMISSION_LABELS[permission];
              if (!Icon || !label) return null;
              return (
                <span key={permission} className="staff-permission-chip">
                  <Icon size={12} />
                  {label}
                </span>
              );
            })}
          </div>
        ),
      },
      {
        header: 'STATUS',
        accessor: (member: Staff) => (
          <div className="staff-status-cell">
            <button
              type="button"
              role="switch"
              aria-checked={member.enabled}
              className={`staff-switch ${member.enabled ? 'on' : ''}`}
              onClick={() => toggleEnabled(member)}
              disabled={togglingId === member.id}
              title={member.enabled ? 'Set inactive' : 'Set active'}
              aria-label={member.enabled ? 'Set inactive' : 'Set active'}
            >
              <span className="staff-switch-knob" />
            </button>
            <span className={`staff-status-label ${member.enabled ? 'active' : 'inactive'}`}>
              {member.enabled ? 'Active' : 'Inactive'}
            </span>
          </div>
        ),
        width: '150px',
      },
      {
        header: 'EDIT',
        accessor: (member: Staff) => (
          <button
            type="button"
            className="staff-edit-btn"
            onClick={() => openEdit(member)}
            title="Edit staff"
            aria-label="Edit staff"
          >
            <Pencil size={14} />
            Edit
          </button>
        ),
        width: '90px',
      },
    ],
    [visibleStaff, togglingId],
  );

  return (
    <div className="vendor-user-page">
      <PageHeader
        title="Staff List"
        subtitle="Create staff accounts and control what each member can access."
        actionLabel="Create New Staff"
        actionIcon={<UserPlus size={16} />}
        onAction={openCreate}
      />

      <label className="vendor-user-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by name or email"
        />
      </label>

      {error && <p className="vendor-user-error">{error}</p>}

      <Table
        columns={columns}
        data={visibleStaff}
        selectable={false}
        loading={loading}
        loadingMessage="Loading staff..."
        emptyMessage="No staff found."
        minWidth="980px"
      />

    </div>
  );
};

export default VendorUserManagement;
