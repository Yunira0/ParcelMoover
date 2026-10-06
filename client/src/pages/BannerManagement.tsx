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
  bannerImageUrl,
  deleteBanner,
  listBanners,
  updateBanner,
  type Banner,
  type BannerStatus,
} from '../services/banners.service';
import './BannerManagement.css';

const STATUS_TONE: Record<BannerStatus, StatusChipTone> = {
  draft: 'neutral',
  scheduled: 'info',
  live: 'success',
  expired: 'warning',
};

const STATUS_LABEL: Record<BannerStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
};

const dateWindow = (banner: Banner) => {
  const start = banner.startsAt ? toBsDate(banner.startsAt) : null;
  const end = banner.endsAt ? toBsDate(banner.endsAt) : null;
  if (!start && !end) return 'Always';
  if (start && !end) return `From ${start}`;
  if (!start && end) return `Until ${end}`;
  return `${start} – ${end}`;
};

const BannerManagement: React.FC = () => {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listBanners();
      setBanners(data);
    } catch {
      setError('Failed to load banners.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (banner: Banner) => {
    setBusyId(banner.id);
    setError('');
    const next = !banner.isEnabled;
    setBanners((prev) => prev.map((b) => (b.id === banner.id ? { ...b, isEnabled: next } : b)));
    try {
      await updateBanner(banner.id, { isEnabled: next });
    } catch {
      setError('Failed to update that banner.');
      setBanners((prev) => prev.map((b) => (b.id === banner.id ? { ...b, isEnabled: banner.isEnabled } : b)));
    } finally {
      setBusyId(null);
    }
  };

  const removeBanner = async (banner: Banner) => {
    if (!window.confirm(`Delete "${banner.name}"? Vendors currently seeing it will stop immediately.`)) return;
    setBusyId(banner.id);
    setError('');
    try {
      await deleteBanner(banner.id);
      setBanners((prev) => prev.filter((b) => b.id !== banner.id));
    } catch {
      setError('Failed to delete that banner.');
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    {
      header: 'PREVIEW',
      accessor: (banner: Banner) => (
        <img
          src={bannerImageUrl(banner.id, banner.imagePath)}
          alt={banner.name}
          className="banner-mgmt-thumb"
        />
      ),
      width: '96px',
    },
    { header: 'NAME', accessor: 'name' as keyof Banner },
    {
      header: 'TYPE',
      accessor: (banner: Banner) => (
        <StatusChip variant="outline" tone="neutral">
          {banner.displayType === 'modal' ? 'Modal' : 'Permanent'}
        </StatusChip>
      ),
    },
    {
      header: 'ENABLED',
      accessor: (banner: Banner) => (
        <ToggleSwitch
          checked={banner.isEnabled}
          onChange={() => toggleEnabled(banner)}
          disabled={busyId === banner.id}
          ariaLabel={`${banner.isEnabled ? 'Disable' : 'Enable'} ${banner.name}`}
        />
      ),
    },
    {
      header: 'STATUS',
      accessor: (banner: Banner) => (
        <StatusChip variant="solid" tone={STATUS_TONE[banner.status]}>
          {STATUS_LABEL[banner.status]}
        </StatusChip>
      ),
    },
    { header: 'WINDOW', accessor: (banner: Banner) => dateWindow(banner) },
    { header: 'PRIORITY', accessor: (banner: Banner) => banner.sortOrder, width: '70px' },
    {
      header: 'ACTION',
      accessor: (banner: Banner) => (
        <TableRowActions onEdit={() => navigate(`/banners/${banner.id}/edit`)}>
          <Button
            variant="outline"
            size="sm"
            disabled={busyId === banner.id}
            onClick={() => removeBanner(banner)}
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
    <div className="banner-management-container">
      <PageHeader
        title="BANNER MANAGEMENT"
        subtitle="Manage the image notices vendors see on their dashboard — modal popups and the permanent hero strip."
        actionLabel="Add banner"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate('/banners/new')}
      />

      {error && <p className="banner-mgmt-error">{error}</p>}

      <Table
        columns={columns}
        data={banners}
        selectable={false}
        loading={loading}
        loadingMessage="Loading banners..."
        emptyMessage="No banners yet. Add one to notify vendors on their dashboard."
      />
    </div>
  );
};

export default BannerManagement;
