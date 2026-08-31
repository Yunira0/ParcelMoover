import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ShieldCheck, FolderOpen } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import { toBsDate } from '../utils/nepaliDate';
import UserActionModal from '../components/UserActionModal';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import Button from '../components/Button';
import ToggleSwitch from '../components/ToggleSwitch';
import UserDocumentsModal from '../components/UserDocumentsModal';
import { getAdmins, updateAdminPermissions, updateAdminRole, updateUserStatus, ADMIN_PERMISSIONS } from '../services/users.service';
import { getCurrentUserRoles, hasAdminPermission } from '../utils/auth';
import '../components/Modal.css';
import './AdminManagement.css';

interface AdminUser {
  id: string;
  sn: number;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  position: string;
  joined: string;
  status: 'active' | 'inactive';
  permissions?: string[];
  isSuperAdmin?: boolean;
}

const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  ADMIN_PERMISSIONS.map((p) => [p.code, p.label]),
);

// Starting rows-per-page. The selector below the table can change it; the
// server caps any value at 100 (auth.controller LIST_MAX_PAGE_SIZE).
const PAGE_SIZE = 20;

const AdminManagement: React.FC = () => {
  const navigate = useNavigate();
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const canManageAdmins = hasAdminPermission('MANAGE_USERS');
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMode, setActionMode] = useState<'edit' | 'password'>('edit');
  const [activeAdmin, setActiveAdmin] = useState<AdminUser | null>(null);
  const [documentsAdmin, setDocumentsAdmin] = useState<AdminUser | null>(null);
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [permAdmin, setPermAdmin] = useState<AdminUser | null>(null);
  const [permDraft, setPermDraft] = useState<string[]>([]);
  const [superAdminDraft, setSuperAdminDraft] = useState(false);
  const [permSaving, setPermSaving] = useState(false);
  const [permError, setPermError] = useState('');

  const [statusSavingIds, setStatusSavingIds] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState('');

  const loadAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page, pageSize: pageSizeChoice };
      if (searchQuery) params.search = searchQuery;
      if (filter !== 'all') params.status = filter;

      const res = await getAdmins(params);
      if (res && res.success && Array.isArray(res.data)) {
        setAdmins(res.data);
        if (res.meta) {
          setTotalPages(res.meta.totalPages);
          setTotal(res.meta.total);
        }
      }
    } catch (err) {
      console.error('Failed to load admins:', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSizeChoice, searchQuery, filter]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, filter]);

  const openPermissions = (admin: AdminUser) => {
    setPermError('');
    setPermDraft(admin.permissions ?? []);
    setSuperAdminDraft(admin.isSuperAdmin ?? false);
    setPermAdmin(admin);
  };

  const togglePermission = (code: string, granted: boolean) => {
    setPermDraft((current) =>
      granted ? [...current, code] : current.filter((c) => c !== code),
    );
  };

  const savePermissions = async () => {
    if (!permAdmin) return;
    try {
      setPermSaving(true);
      setPermError('');
      const roleChanged = superAdminDraft !== (permAdmin.isSuperAdmin ?? false);
      if (roleChanged) {
        await updateAdminRole(permAdmin.id, superAdminDraft);
      }
      if (!superAdminDraft) {
        await updateAdminPermissions(permAdmin.id, permDraft);
      }
      setPermAdmin(null);
      await loadAdmins();
    } catch (err: any) {
      setPermError(err?.response?.data?.message ?? 'Failed to update permissions');
    } finally {
      setPermSaving(false);
    }
  };

  const toggleAdminStatus = async (admin: AdminUser) => {
    const nextStatus = admin.status === 'active' ? 'inactive' : 'active';
    setStatusError('');
    setStatusSavingIds(prev => new Set(prev).add(admin.id));
    setAdmins(prev => prev.map(a => (a.id === admin.id ? { ...a, status: nextStatus } : a)));
    try {
      await updateUserStatus('admin', admin.id, nextStatus);
    } catch (err) {
      console.error('Failed to update admin status:', err);
      setAdmins(prev => prev.map(a => (a.id === admin.id ? { ...a, status: admin.status } : a)));
      setStatusError(`Failed to set ${admin.name} ${nextStatus}. Please try again.`);
    } finally {
      setStatusSavingIds(prev => {
        const next = new Set(prev);
        next.delete(admin.id);
        return next;
      });
    }
  };

  const columns = [
    { header: 'SN', accessor: 'sn' as keyof AdminUser, width: '50px' },
    { header: 'EMPLOYEE ID', accessor: (a: AdminUser) => a.employeeId || '—', width: '110px' },
    { header: 'NAME', accessor: 'name' as keyof AdminUser },
    { header: 'EMAIL', accessor: 'email' as keyof AdminUser },
    { header: 'PHONE', accessor: 'phone' as keyof AdminUser },
    { header: 'LOCATION', accessor: 'location' as keyof AdminUser },
    { header: 'POSITION', accessor: 'position' as keyof AdminUser },
    { header: 'JOINED', accessor: (a: AdminUser) => toBsDate(a.joined) || '—' },
    ...(isSuperAdmin
      ? [{
          header: 'PERMISSIONS',
          accessor: (item: AdminUser) =>
            item.isSuperAdmin ? (
              <StatusChip tone="warning">Super Admin</StatusChip>
            ) : item.permissions && item.permissions.length > 0 ? (
              <div className="admin-permission-chips">
                {item.permissions.map((code) => (
                  <StatusChip key={code} tone="info">
                    {PERMISSION_LABELS[code] ?? code}
                  </StatusChip>
                ))}
              </div>
            ) : (
              '-'
            ),
        }]
      : []),
    {
      header: 'STATUS',
      accessor: (item: AdminUser) => (
        <div className="admin-status-cell">
          <ToggleSwitch
            checked={item.status === 'active'}
            disabled={statusSavingIds.has(item.id)}
            onChange={() => toggleAdminStatus(item)}
            ariaLabel={`Set ${item.name} ${item.status === 'active' ? 'inactive' : 'active'}`}
          />
          <StatusChip variant="solid" tone={item.status === 'active' ? 'success' : 'danger'}>
            {item.status}
          </StatusChip>
        </div>
      ),
      width: '150px'
    },
    // Registration documents, in the same slot vendor management puts them:
    // last read-only column before the row actions.
    {
      header: 'DOCUMENTS',
      accessor: (item: AdminUser) => (
        <Button variant="outline" size="sm" onClick={() => setDocumentsAdmin(item)}>
          <FolderOpen size={14} />
          View
        </Button>
      ),
      width: '120px',
    },
    ...(canManageAdmins
      ? [{
          header: 'ACTION',
          accessor: (item: AdminUser) => (
            <TableRowActions
              onEdit={() => navigate(`/admin/${item.id}/edit`)}
              onUpdatePassword={() => {
                setActiveAdmin(item);
                setActionMode('password');
              }}
            >
              {isSuperAdmin && (
                <Button variant="outline" size="sm" onClick={() => openPermissions(item)}>
                  <ShieldCheck size={14} />
                  Permissions
                </Button>
              )}
            </TableRowActions>
          ),
          width: isSuperAdmin ? '340px' : '220px',
        }]
      : []),
  ];

  return (
    <div className="admin-management-container">
      <PageHeader
        title="ADMIN MANAGEMENT"
        subtitle="Oversee admin accounts and track performance metrics."
        {...(canManageAdmins
          ? {
              actionLabel: 'Add new',
              actionIcon: <Plus size={16} />,
              onAction: () => navigate('/admin/new'),
            }
          : {})}
      />

      <div className="admin-filters">
        <SegmentedTabs
          ariaLabel="Admin status filter"
          fullWidth={false}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'ACTIVE' },
          ]}
        />

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
      </div>

      {statusError && <p className="admin-status-error">{statusError}</p>}

      {loading ? (
        <div className="loading-state">Loading admins...</div>
      ) : (
        <>
          <Table columns={columns} data={admins} selectable={false} />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Admin management pagination"
            summary={`${total} admin${total !== 1 ? 's' : ''} total`}
            pageSize={pageSizeChoice}
            pageSizeLabel="admins"
            onPageSizeChange={(size) => {
              setPageSizeChoice(size);
              setPage(1);
            }}
          />
        </>
      )}

      <UserDocumentsModal
        isOpen={Boolean(documentsAdmin)}
        userType="admin"
        target={documentsAdmin ? { id: documentsAdmin.id, name: documentsAdmin.name } : null}
        onClose={() => setDocumentsAdmin(null)}
      />

      <UserActionModal
        isOpen={Boolean(activeAdmin)}
        mode={actionMode}
        userType="admin"
        target={activeAdmin}
        onClose={() => setActiveAdmin(null)}
        onSuccess={loadAdmins}
      />

      {permAdmin && (
        <div className="modal-overlay" onClick={() => !permSaving && setPermAdmin(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Permissions - {permAdmin.name}</h2>
              <Button
                variant="ghost"
                size="icon"
                className="modal-close-btn"
                onClick={() => setPermAdmin(null)}
                disabled={permSaving}
                type="button"
              >
                &times;
              </Button>
            </div>

            <p className="modal-desc">
              Delegate super admin privileges to this staff account. Changes take
              effect on their next login or page refresh.
            </p>

            <div className="admin-permission-list">
              <div className="admin-permission-row admin-permission-row--role">
                <div>
                  <div className="admin-permission-name">Super Admin</div>
                  <div className="admin-permission-desc">
                    Full control of the whole system, including granting permissions to other admins.
                  </div>
                </div>
                <ToggleSwitch
                  checked={superAdminDraft}
                  onChange={setSuperAdminDraft}
                  disabled={permSaving}
                  ariaLabel={`Make ${permAdmin.name} a super admin`}
                />
              </div>

              {ADMIN_PERMISSIONS.map((perm) => (
                <div className="admin-permission-row" key={perm.code}>
                  <div>
                    <div className="admin-permission-name">{perm.label}</div>
                    <div className="admin-permission-desc">{perm.description}</div>
                  </div>
                  <ToggleSwitch
                    checked={superAdminDraft || permDraft.includes(perm.code)}
                    onChange={(checked) => togglePermission(perm.code, checked)}
                    disabled={permSaving || superAdminDraft}
                    ariaLabel={`Grant ${perm.label} to ${permAdmin.name}`}
                  />
                </div>
              ))}
              {superAdminDraft && (
                <p className="admin-permission-hint">
                  A super admin implicitly holds every permission.
                </p>
              )}
            </div>

            {permError && <p className="admin-permission-error">{permError}</p>}

            <div className="admin-permission-actions">
              <Button variant="secondary" onClick={() => setPermAdmin(null)} disabled={permSaving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={savePermissions} disabled={permSaving}>
                {permSaving ? 'Saving...' : 'Save permissions'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminManagement;
