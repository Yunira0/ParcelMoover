import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import Table, { TableRowActions } from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import ToggleSwitch from '../components/ToggleSwitch';
import { toBsDate } from '../utils/nepaliDate';
import {
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementStatus,
} from '../services/announcements.service';
import './AnnouncementManagement.css';

const STATUS_TONE: Record<AnnouncementStatus, StatusChipTone> = {
  draft: 'neutral',
  scheduled: 'info',
  live: 'success',
  expired: 'warning',
};

const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
};

const dateWindow = (a: Announcement) => {
  const start = a.startsAt ? toBsDate(a.startsAt) : null;
  const end = a.endsAt ? toBsDate(a.endsAt) : null;
  if (!start && !end) return 'Always';
  if (start && !end) return `From ${start}`;
  if (!start && end) return `Until ${end}`;
  return `${start} – ${end}`;
};

const AnnouncementManagement: React.FC = () => {
  const navigate = useNavigate();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listAnnouncements();
      setAnnouncements(data);
    } catch {
      setError('Failed to load announcements.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (a: Announcement) => {
    setBusyId(a.id);
    setError('');
    const next = !a.isEnabled;
    setAnnouncements((prev) => prev.map((row) => (row.id === a.id ? { ...row, isEnabled: next } : row)));
    try {
      await updateAnnouncement(a.id, { isEnabled: next });
    } catch {
      setError('Failed to update that announcement.');
      setAnnouncements((prev) => prev.map((row) => (row.id === a.id ? { ...row, isEnabled: a.isEnabled } : row)));
    } finally {
      setBusyId(null);
    }
  };

  const removeAnnouncement = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"? Vendors currently seeing it will stop immediately.`)) return;
    setBusyId(a.id);
    setError('');
    try {
      await deleteAnnouncement(a.id);
      setAnnouncements((prev) => prev.filter((row) => row.id !== a.id));
    } catch {
      setError('Failed to delete that announcement.');
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { header: 'TITLE', accessor: 'title' as keyof Announcement },
    {
      header: 'ENABLED',
      accessor: (a: Announcement) => (
        <ToggleSwitch
          checked={a.isEnabled}
          onChange={() => toggleEnabled(a)}
          disabled={busyId === a.id}
          ariaLabel={`${a.isEnabled ? 'Disable' : 'Enable'} ${a.title}`}
        />
      ),
    },
    {
      header: 'STATUS',
      accessor: (a: Announcement) => (
        <StatusChip variant="solid" tone={STATUS_TONE[a.status]}>
          {STATUS_LABEL[a.status]}
        </StatusChip>
      ),
    },
    { header: 'WINDOW', accessor: (a: Announcement) => dateWindow(a) },
    { header: 'PRIORITY', accessor: (a: Announcement) => a.sortOrder, width: '70px' },
    {
      header: 'ACTION',
      accessor: (a: Announcement) => (
        <TableRowActions onEdit={() => navigate(`/announcements/${a.id}/edit`)}>
          <Button
            variant="outline"
            size="sm"
            disabled={busyId === a.id}
            onClick={() => removeAnnouncement(a)}
          >
            <Trash2 size={14} />
            Delete
          </Button>
        </TableRowActions>
      ),
      width: '220px',
    },
  ];

  return (
    <div className="announcement-management-container">
      <PageHeader
        title="ANNOUNCEMENTS"
        subtitle="Manage the operational notices vendors see on their dashboard."
        actionLabel="Add announcement"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate('/announcements/new')}
      />

      {error && <p className="announcement-mgmt-error">{error}</p>}

      <Table
        columns={columns}
        data={announcements}
        selectable={false}
        loading={loading}
        loadingMessage="Loading announcements..."
        emptyMessage="No announcements yet. Add one to notify vendors on their dashboard."
      />
    </div>
  );
};

export default AnnouncementManagement;
