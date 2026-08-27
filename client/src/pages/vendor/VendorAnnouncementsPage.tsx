import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { toBsDateLabel } from '../../utils/nepaliDate';
import { getActiveAnnouncements, type Announcement } from '../../services/announcements.service';
import './VendorAnnouncementsPage.css';

const VendorAnnouncementsPage: React.FC = () => {
  const navigate = useNavigate();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getActiveAnnouncements()
      .then(setAnnouncements)
      .catch(() => setError('Failed to load announcements.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="vendor-announcements-page">
      <PageHeader title="ANNOUNCEMENTS" subtitle="Operational notices and updates from ParcelMoover." />

      {error && <p className="vendor-announcements-page-error">{error}</p>}

      {loading ? (
        <p className="vendor-announcements-page-muted">Loading announcements…</p>
      ) : announcements.length === 0 ? (
        <p className="vendor-announcements-page-muted">No announcements right now.</p>
      ) : (
        <div className="vendor-announcements-page-list">
          {announcements.map((a) => (
            <button
              key={a.id}
              type="button"
              className="vendor-announcements-page-row"
              onClick={() => navigate(`/vendor/announcements/${a.id}`)}
            >
              <span className="vendor-announcements-page-row-title">{a.title}</span>
              <span className="vendor-announcements-page-row-date">{toBsDateLabel(a.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorAnnouncementsPage;
