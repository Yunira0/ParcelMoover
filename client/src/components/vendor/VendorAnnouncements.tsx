import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Megaphone, ChevronRight } from 'lucide-react';
import { toBsDateLabel } from '../../utils/nepaliDate';
import { getActiveAnnouncements, type Announcement } from '../../services/announcements.service';
import './VendorAnnouncements.css';

// How many rows the dashboard card shows before "View all" takes over —
// the full list lives at /vendor/announcements.
const CARD_LIMIT = 5;

/**
 * The dashboard's Announcements card: operational notices (payment cutoffs,
 * service disruptions, new branches) distinct from the image-only banners.
 * Renders nothing on a failed fetch — a notice going missing must never take
 * the dashboard down with it — but shows an empty state once loaded with
 * nothing live, so the card still teaches what belongs here.
 */
const VendorAnnouncements: React.FC = () => {
  const navigate = useNavigate();
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);

  useEffect(() => {
    let alive = true;
    getActiveAnnouncements()
      .then((data) => {
        if (alive) setAnnouncements(data);
      })
      .catch(() => {
        // Non-fatal; the dashboard has its own job to do.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (announcements === null) return null;

  const visible = announcements.slice(0, CARD_LIMIT);

  return (
    <div className="vendor-announcements">
      <div className="vendor-announcements-header">
        <Megaphone size={15} />
        <span className="vendor-announcements-title">Announcements</span>
      </div>

      {visible.length === 0 ? (
        <p className="vendor-announcements-empty">No announcements right now.</p>
      ) : (
        <div className="vendor-announcements-rows">
          {visible.map((a) => (
            <button
              key={a.id}
              type="button"
              className="vendor-announcements-row"
              onClick={() => navigate(`/vendor/announcements/${a.id}`)}
            >
              <span className="vendor-announcements-row-title">{a.title}</span>
              <span className="vendor-announcements-row-date">{toBsDateLabel(a.createdAt)}</span>
            </button>
          ))}
        </div>
      )}

      {announcements.length > 0 && (
        <button
          type="button"
          className="vendor-announcements-view-all"
          onClick={() => navigate('/vendor/announcements')}
        >
          View all announcements
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
};

export default VendorAnnouncements;
